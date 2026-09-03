import fs from "fs-extra";
import path from "path";
import { CONSTANTS } from "./constants.js";
import { log } from "./log.js";
import { stripVersionPrefix } from "./utils.js";
import type { NavigationDropdown } from "../types.js";

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n/;
const BANNER_START = "{/* version-banner:start */}";
const BANNER_END = "{/* version-banner:end */}";

// Matches exactly what this module inserts, including the newlines around
// it, so removing a banner restores the page byte for byte. Anchored at the
// start of the body and on both markers, and non-greedy, so a `{/* ... */}`
// comment elsewhere in a page cannot be swallowed.
const BANNER_BLOCK_PATTERN =
  /^\n\{\/\* version-banner:start \*\/\}[\s\S]*?\{\/\* version-banner:end \*\/\}\n/;

export interface BannerResult {
  latest: number;
  bannered: number;
  changed: number;
  missing: string[];
}

interface BannerContext {
  /** Dropdown title, e.g. "SDK (JavaScript)" or "CLI". */
  sdkName: string;
  /** Version the page documents, e.g. "v1.0.0". */
  version: string;
  /** Module the page documents, e.g. "sandbox". */
  module: string;
  /** Where to send the reader, always a version-agnostic `/latest/` path. */
  latestUrl: string;
  /** Whether this module still exists in the newest release. */
  inLatest: boolean;
}

/**
 * The banner text for one superseded page.
 *
 * Written as inline MDX rather than as a `snippets/` component on purpose.
 * Mintlify serves a raw `.md` variant of every page and publishes
 * `/llms.txt`, and agents are now the majority of reference readers, so the
 * warning has to survive as prose. A `<VersionBanner />` import would reach
 * them as an unexpanded tag and tell them nothing.
 *
 * It deliberately never names the newest version. Naming it would change the
 * text of every superseded page on every release, which is a ~2,000 file
 * rewrite several times a week (see SDK-323). The `/latest/` path carries the
 * same information and never moves.
 *
 * The link sits in its own paragraph rather than trailing the sentence, so it
 * is the one thing a reader who has just realised they are on the wrong page
 * has to find.
 */
function buildBanner(context: BannerContext): string {
  const version = stripVersionPrefix(context.version);

  const lead = `You are currently viewing documentation for version ${version} of the E2B ${context.sdkName}.`;

  const [body, link] = context.inLatest
    ? [lead, "View the latest version of this page"]
    : [
        `${lead} The \`${context.module}\` module does not exist in the latest version.`,
        "View the latest version of this reference",
      ];

  return `<Warning>\n  ${body}\n\n  [${link}](${context.latestUrl}).\n</Warning>`;
}

/**
 * Add, update, or remove the managed version banner on one page's content.
 *
 * Any existing banner block is stripped before the wanted state is written,
 * which makes the transform idempotent and lets a page lose its banner if it
 * is ever the newest version again.
 *
 * The banner is inserted around the body rather than over it: whatever
 * whitespace the generator left after the frontmatter is preserved, so this
 * pass only ever adds and removes its own block. Some generated pages carry
 * several blank lines there, and reflowing them would put thousands of
 * unrelated lines in every sync diff.
 *
 * Content without frontmatter is returned untouched, for the same reason
 * `applyNoindexDirective` does it: every generated page gets frontmatter from
 * `flattenMarkdown` and `verifyGeneratedDocs` fails the run if one does not,
 * so a page in that state is already broken and this is not the place to
 * paper over it.
 */
export function applyVersionBanner(
  content: string,
  banner: string | null
): string {
  const match = content.match(FRONTMATTER_PATTERN);

  if (!match) {
    return content;
  }

  const frontmatter = match[0];
  const body = content
    .slice(frontmatter.length)
    .replace(BANNER_BLOCK_PATTERN, "");

  if (!banner) {
    return frontmatter + body;
  }

  return `${frontmatter}\n${BANNER_START}\n${banner}\n${BANNER_END}\n${body}`;
}

/** `sdk-reference/{sdkKey}/{version}/{module}` -> its parts. */
function parsePagePath(
  page: string
): { sdkKey: string; version: string; module: string } | null {
  const parts = page.split("/");

  if (parts.length !== 4 || parts[0] !== CONSTANTS.DOCS_SDK_REF_PATH) {
    return null;
  }

  return { sdkKey: parts[1], version: parts[2], module: parts[3] };
}

/**
 * Tell readers of an old SDK version that they are on one.
 *
 * Mintlify renders a version switcher in the sidebar, so a reader *can* move
 * to the current release, but nothing on the page says they are not already
 * on it. Stale versions draw real traffic from search and from agents, so
 * most readers of a superseded page never chose that version.
 *
 * This runs as a post-pass over the navigation on every sync, exactly like
 * `syncIndexingDirectives`, because generation is incremental: a page written
 * while its version was the newest is never rewritten once a later release
 * supersedes it, so the banner has to be re-derived from the current set of
 * versions each run.
 *
 * The link target is the version-agnostic `/sdk-reference/{sdk}/latest/...`
 * path, which `buildLatestRedirects` keeps pointed at the newest release. It
 * is a redirect rather than a served page today (SDK-323 item 2), which
 * costs the reader one hop and keeps this pass from rewriting every
 * superseded page on every release.
 */
export async function syncVersionBanners(
  navigation: NavigationDropdown[],
  docsDir: string
): Promise<BannerResult> {
  const result: BannerResult = {
    latest: 0,
    bannered: 0,
    changed: 0,
    missing: [],
  };

  for (const dropdown of navigation) {
    const latest = dropdown.versions.find((v) => v.default);

    if (!latest || latest.pages.length === 0) {
      log.warn(`${dropdown.dropdown} has no default version, skipping`, 1);
      continue;
    }

    const latestModules = new Set(
      latest.pages
        .map((page) => parsePagePath(page)?.module)
        .filter((module): module is string => Boolean(module))
    );

    // Where a reader goes when the module they are on is gone from the
    // newest release. Mirrors what Mintlify's own version switcher does:
    // land on the version's first page rather than a 404.
    const fallback = parsePagePath(latest.pages[0]);

    if (!fallback) {
      log.warn(`${dropdown.dropdown} has an unparseable page path, skipping`, 1);
      continue;
    }

    for (const version of dropdown.versions) {
      for (const page of version.pages) {
        const file = path.join(docsDir, `${page}${CONSTANTS.MDX_EXTENSION}`);

        if (!(await fs.pathExists(file))) {
          result.missing.push(page);
          continue;
        }

        const parsed = parsePagePath(page);

        if (!parsed) {
          result.missing.push(page);
          continue;
        }

        const inLatest = latestModules.has(parsed.module);
        const target = inLatest ? parsed.module : fallback.module;

        const banner = version.default
          ? null
          : buildBanner({
              sdkName: dropdown.dropdown,
              version: parsed.version,
              module: parsed.module,
              latestUrl: `/${CONSTANTS.DOCS_SDK_REF_PATH}/${parsed.sdkKey}/latest/${target}`,
              inLatest,
            });

        const content = await fs.readFile(file, "utf-8");
        const updated = applyVersionBanner(content, banner);

        if (updated !== content) {
          await fs.writeFile(file, updated);
          result.changed++;
        }

        if (banner) {
          result.bannered++;
        } else {
          result.latest++;
        }
      }
    }
  }

  log.info(
    `${result.bannered} superseded pages bannered, ${result.latest} on the latest version`,
    1
  );
  log.info(`Rewrote ${result.changed} files`, 1);

  if (result.missing.length > 0) {
    log.warn(`${result.missing.length} navigation pages have no MDX file`, 1);
    for (const page of result.missing.slice(0, 10)) {
      log.data(page, 2);
    }
  }

  return result;
}
