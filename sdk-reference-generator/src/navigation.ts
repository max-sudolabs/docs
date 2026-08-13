import fs from "fs-extra";
import path from "path";
import sdks from "../sdks.config.js";
import {
  sortVersionsDescending,
  isValidVersion,
  normalizeVersion,
} from "./lib/utils.js";
import { CONSTANTS } from "./lib/constants.js";
import { log } from "./lib/log.js";
import type {
  NavigationDropdown,
  NavigationDropdownWithOrder,
  RedirectEntry,
} from "./types.js";

async function getVersions(sdkDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(sdkDir, { withFileTypes: true });

    const versions = entries
      .filter((e) => e.isDirectory() && isValidVersion(e.name))
      .map((e) => e.name);

    return sortVersionsDescending(versions);
  } catch {
    return [];
  }
}

async function getModules(versionDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(versionDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(CONSTANTS.MDX_EXTENSION))
      .map((e) => e.name.replace(CONSTANTS.MDX_EXTENSION, ""))
      .sort();
  } catch {
    return [];
  }
}

export async function buildNavigation(
  docsDir: string
): Promise<NavigationDropdown[]> {
  const sdkRefDir = path.join(docsDir, CONSTANTS.DOCS_SDK_REF_PATH);

  if (!(await fs.pathExists(sdkRefDir))) {
    log.warn(`SDK reference directory not found: ${sdkRefDir}`);
    return [];
  }

  const navigation: NavigationDropdownWithOrder[] = [];

  for (const [sdkKey, sdkConfig] of Object.entries(sdks)) {
    const sdkDir = path.join(sdkRefDir, sdkKey);

    if (!(await fs.pathExists(sdkDir))) {
      log.data(`Skipping ${sdkKey} (not found)`);
      continue;
    }

    const versions = await getVersions(sdkDir);
    if (versions.length === 0) {
      log.data(`Skipping ${sdkKey} (no versions)`);
      continue;
    }

    log.data(`Found ${sdkKey}: ${versions.length} versions`);

    // Version labels have to be unique across dropdowns.
    //
    // Mintlify's dropdown switcher resolves a destination by version label
    // alone, without accounting for which SDK that version belongs to. Our
    // SDKs reuse version numbers, so identical labels cross-wire and every
    // option resolves back into the SDK you are already viewing. Suffixing the
    // label with the SDK keeps them distinct. Labels are display-only, so page
    // URLs are unaffected. Confirmed by Mintlify support.
    const versionLabel = sdkConfig.versionLabel ?? sdkKey;

    const dropdown: NavigationDropdownWithOrder = {
      dropdown: sdkConfig.displayName,
      icon: sdkConfig.icon,
      versions: await Promise.all(
        versions.map(async (version, index) => {
          const versionDir = path.join(sdkDir, version);
          const modules = await getModules(versionDir);
          const normalizedVersion = normalizeVersion(version);

          return {
            version: `${normalizedVersion} (${versionLabel})`,
            default: index === 0,
            pages: modules.map(
              (module) =>
                `${CONSTANTS.DOCS_SDK_REF_PATH}/${sdkKey}/${normalizedVersion}/${module}`
            ),
          };
        })
      ),
      _order: sdkConfig.order,
    };

    navigation.push(dropdown);
  }

  return navigation
    .sort((a, b) => a._order - b._order)
    .map(({ _order, ...rest }) => rest);
}

/**
 * Build version-agnostic "latest" redirects from the navigation.
 *
 * For each SDK, emits a single wildcard redirect that points a stable
 * `.../latest/...` path at the newest (default) version, e.g.
 *   /sdk-reference/js-sdk/latest/:slug*  ->  /sdk-reference/js-sdk/v2.29.1/:slug*
 *
 * These are regenerated on every sync so they always track the current
 * release. They are non-permanent because the destination moves over time.
 */
export function buildLatestRedirects(
  navigation: NavigationDropdown[]
): RedirectEntry[] {
  const redirects: RedirectEntry[] = [];

  for (const dropdown of navigation) {
    const latestVersion = dropdown.versions.find((v) => v.default);
    const firstPage = latestVersion?.pages[0];
    if (!latestVersion || !firstPage) continue;

    // pages look like: sdk-reference/{sdkKey}/{version}/{module}
    const parts = firstPage.split("/");
    const sdkKey = parts[1];
    const version = parts[2];
    if (!sdkKey || !version) continue;

    const base = `/${CONSTANTS.DOCS_SDK_REF_PATH}/${sdkKey}`;
    redirects.push({
      source: `${base}/latest/:slug*`,
      destination: `${base}/${version}/:slug*`,
      permanent: false,
    });
  }

  return redirects;
}

function isLatestSdkRedirect(source: unknown): boolean {
  return (
    typeof source === "string" &&
    new RegExp(
      `^/${CONSTANTS.DOCS_SDK_REF_PATH}/[^/]+/latest/`
    ).test(source)
  );
}

export async function mergeNavigation(
  navigation: NavigationDropdown[],
  docsDir: string
): Promise<void> {
  const docsJsonPath = path.join(docsDir, "docs.json");

  if (!(await fs.pathExists(docsJsonPath))) {
    throw new Error("docs.json not found");
  }

  const docsJson = await fs.readJSON(docsJsonPath);

  const tabs = docsJson.navigation?.tabs;
  const anchors = docsJson.navigation?.anchors;
  const usesTabs = Array.isArray(tabs);
  const sections = usesTabs ? tabs : anchors;
  const labelKey = usesTabs ? "tab" : "anchor";

  if (!Array.isArray(sections)) {
    throw new Error("No tabs or anchors found in docs.json");
  }

  const validDropdowns = navigation.filter(
    (d) => d.versions && d.versions.length > 0
  );

  if (validDropdowns.length === 0) {
    log.warn("No SDK versions found, keeping existing docs.json");
    return;
  }

  const sdkRefSection = {
    [labelKey]: CONSTANTS.SDK_REFERENCE_ANCHOR,
    icon: "brackets-curly",
    dropdowns: validDropdowns,
  };

  const sdkRefIndex = sections.findIndex(
    (section: Record<string, unknown>) =>
      section[labelKey] === CONSTANTS.SDK_REFERENCE_ANCHOR
  );

  if (sdkRefIndex === -1) {
    log.info(
      `Creating new ${CONSTANTS.SDK_REFERENCE_ANCHOR} ${labelKey}`,
      1
    );
    sections.push(sdkRefSection);
  } else {
    sections[sdkRefIndex] = sdkRefSection;
  }

  // Refresh the "latest" redirects so they track the newest version. Existing
  // manual redirects are preserved; only the generated SDK latest ones are
  // replaced.
  const latestRedirects = buildLatestRedirects(validDropdowns);
  const existingRedirects: RedirectEntry[] = Array.isArray(docsJson.redirects)
    ? docsJson.redirects
    : [];
  docsJson.redirects = [
    ...existingRedirects.filter((r) => !isLatestSdkRedirect(r?.source)),
    ...latestRedirects,
  ];
  log.info(`Refreshed ${latestRedirects.length} SDK "latest" redirects`, 1);

  await fs.writeJSON(docsJsonPath, docsJson, { spaces: 2 });
  const content = await fs.readFile(docsJsonPath, "utf-8");
  if (!content.endsWith("\n")) {
    await fs.appendFile(docsJsonPath, "\n");
  }

  log.success(`Updated docs.json with ${validDropdowns.length} SDK dropdowns`);

  for (const dropdown of validDropdowns) {
    const totalVersions = dropdown.versions.length;
    const totalPages = dropdown.versions.reduce(
      (sum, v) => sum + (v.pages?.length || 0),
      0
    );
    log.data(
      `${dropdown.dropdown}: ${totalVersions} versions, ${totalPages} pages`
    );
  }
}
