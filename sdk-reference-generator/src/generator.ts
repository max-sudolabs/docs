import fs from "fs-extra";
import path from "path";
import type {
  SDKConfig,
  GenerationContext,
  GenerationResult,
  TypedocConfig,
  PydocConfig,
} from "./types.js";
import sdks from "../sdks.config.js";
import { log } from "./lib/log.js";
import { fetchRemoteTags, resolveLatestVersion } from "./lib/git.js";
import {
  fetchLocalVersions,
  filterByMinVersion,
  diffVersions,
  versionExists,
} from "./lib/versions.js";
import { flattenMarkdown, copyToDocs, locateSDKDir } from "./lib/files.js";
import { installDependencies } from "./lib/install.js";
import { generateTypedoc } from "./generators/typedoc.js";
import { generatePydoc } from "./generators/pydoc.js";
import { generateCli } from "./generators/cli.js";
import { buildSDKPath } from "./lib/utils.js";
import { CONSTANTS } from "./lib/constants.js";
import { CheckoutManager } from "./lib/checkout.js";
import { resolveConfig } from "./lib/config.js";

async function generateVersion(
  sdkKey: string,
  config: SDKConfig,
  version: string,
  context: GenerationContext,
  checkoutMgr: CheckoutManager,
  isFirstVersion: boolean
): Promise<void> {
  const tagName = config.tagFormat.replace(
    "{version}",
    version.replace(/^v/, "")
  );

  let repoDir: string;

  if (isFirstVersion) {
    repoDir = await checkoutMgr.getOrClone(
      sdkKey,
      config.repo,
      tagName,
      context.tempDir
    );
  } else {
    await checkoutMgr.switchVersion(sdkKey, tagName);
    repoDir = checkoutMgr.getRepoDir(sdkKey)!;
  }

  const sdkDir = await locateSDKDir(repoDir, config.sdkPath, config.sdkPaths);
  if (!sdkDir) {
    throw new Error(
      `SDK path not found: ${config.sdkPath || config.sdkPaths?.join(", ")}`
    );
  }

  const sdkRefDir = path.join(sdkDir, CONSTANTS.SDK_REF_DIR);
  await fs.remove(sdkRefDir);

  const installResult = await installDependencies(sdkDir, config.generator);

  let generatedDocsDir: string;
  switch (config.generator) {
    case "typedoc": {
      const resolvedConfig = resolveConfig<TypedocConfig>(
        config.defaultConfig,
        config.configOverrides,
        version
      );
      generatedDocsDir = await generateTypedoc(
        sdkDir,
        resolvedConfig,
        context.configsDir
      );
      break;
    }
    case "pydoc": {
      const resolvedConfig = resolveConfig<PydocConfig>(
        config.defaultConfig,
        config.configOverrides,
        version
      );
      generatedDocsDir = await generatePydoc(
        sdkDir,
        resolvedConfig,
        installResult.usePoetryRun,
        context.configsDir
      );
      break;
    }
    case "cli":
      generatedDocsDir = await generateCli(sdkDir);
      break;
  }

  if (generatedDocsDir !== sdkRefDir) {
    log.info(`Normalizing ${path.basename(generatedDocsDir)} to sdk_ref`, 1);
    await fs.move(generatedDocsDir, sdkRefDir, { overwrite: true });
  }

  await flattenMarkdown(sdkRefDir);

  const destDir = buildSDKPath(context.docsDir, sdkKey, version);
  const success = await copyToDocs(
    sdkRefDir,
    destDir,
    config.displayName,
    version
  );

  if (!success) {
    throw new Error("Failed to copy generated files");
  }
}

async function discoverAllVersions(
  sdkKey: string,
  config: SDKConfig,
  context: GenerationContext
): Promise<string[]> {
  log.info("Discovering all versions...", 1);

  let remote = await fetchRemoteTags(config.repo, config.tagPattern);

  if (remote.length === 0) {
    if (config.required) {
      throw new Error(`No tags found for required SDK: ${sdkKey}`);
    }
    log.warn("No tags found, skipping...", 1);
    return [];
  }

  if (config.minVersion) {
    remote = filterByMinVersion(remote, config.minVersion);
    log.info(`Filtered to versions >= ${config.minVersion}`, 1);
  }

  if (context.limit && context.limit > 0) {
    remote = remote.slice(0, context.limit);
    log.info(`Limited to last ${context.limit} versions`, 1);
  }

  const local = await fetchLocalVersions(sdkKey, context.docsDir);

  log.blank();
  log.step("Version Discovery", 1);
  log.stats(
    [
      { label: "Remote", value: remote.length },
      { label: "Local", value: local.length },
    ],
    1
  );

  const missing = context.force ? remote : diffVersions(remote, local);

  log.stats(
    [
      {
        label: context.force ? "To Generate (forced)" : "Missing",
        value: missing.length,
      },
    ],
    1
  );
  log.blank();

  if (missing.length === 0) {
    log.success("Nothing to generate", 1);
    return [];
  }

  if (context.force && local.length > 0) {
    log.warn("FORCE MODE: Will regenerate existing versions", 1);
  }

  return missing;
}

async function resolveSpecificVersion(
  sdkKey: string,
  config: SDKConfig,
  versionArg: string,
  context: GenerationContext
): Promise<string[]> {
  const resolved = await resolveLatestVersion(
    config.repo,
    config.tagPattern,
    versionArg
  );

  if (!resolved) {
    if (config.required) {
      throw new Error(`No tags found for required SDK: ${sdkKey}`);
    }
    log.warn("No tags found, skipping...", 1);
    return [];
  }

  if (
    !context.force &&
    (await versionExists(sdkKey, resolved, context.docsDir))
  ) {
    log.success(`${resolved} already exists`, 1);
    return [];
  }

  if (context.force) {
    log.warn("FORCE MODE: Will regenerate existing version", 1);
  }

  return [resolved];
}

async function processVersionBatch(
  sdkKey: string,
  config: SDKConfig,
  versions: string[],
  context: GenerationContext
): Promise<GenerationResult> {
  let generated = 0;
  let failed = 0;
  const failedVersions: string[] = [];

  const checkoutMgr = new CheckoutManager();

  try {
    for (let i = 0; i < versions.length; i++) {
      const version = versions[i];
      const isFirstVersion = i === 0;

      log.blank();
      log.step(`Generating ${version}`, 1);

      try {
        await generateVersion(
          sdkKey,
          config,
          version,
          context,
          checkoutMgr,
          isFirstVersion
        );
        log.success(`Complete: ${version}`, 1);
        generated++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error(`Failed: ${version} - ${msg}`, 1);
        failed++;
        failedVersions.push(version);
      }
    }
  } finally {
    await checkoutMgr.cleanup();
  }

  return { generated, failed, failedVersions };
}

export function handleGenerationFailures(
  config: SDKConfig,
  result: GenerationResult
): void {
  const { generated, failed, failedVersions } = result;

  log.blank();
  log.step("Summary", 1);
  log.stats(
    [
      { label: "Generated", value: generated },
      ...(failed > 0
        ? [
            {
              label: "Failed",
              value: `${failed} (${failedVersions.join(" ")})`,
            },
          ]
        : []),
    ],
    1
  );

  if (failed === 0) return;

  const shouldAbort = config.required || generated === 0;
  if (shouldAbort) {
    log.blank();
    const reason = config.required
      ? "Required SDK has failures"
      : "All versions failed";
    log.error(`WORKFLOW ABORTED: ${reason}`, 1);
    log.error(`Failed: ${failedVersions.join(" ")}`, 1);
    throw new Error(`Generation aborted: ${reason}`);
  }
}

export async function generateSDK(
  sdkKey: string,
  versionArg: string,
  context: GenerationContext
): Promise<GenerationResult> {
  const config = sdks[sdkKey as keyof typeof sdks];

  if (!config) {
    log.error(`SDK '${sdkKey}' not found in config`, 1);
    return { generated: 0, failed: 1, failedVersions: [sdkKey] };
  }

  log.info(`${config.displayName} version: ${versionArg}`, 1);

  const versionsToProcess =
    versionArg === "all"
      ? await discoverAllVersions(sdkKey, config, context)
      : await resolveSpecificVersion(sdkKey, config, versionArg, context);

  if (versionsToProcess.length === 0) {
    return { generated: 0, failed: 0, failedVersions: [] };
  }

  const result = await processVersionBatch(
    sdkKey,
    config,
    versionsToProcess,
    context
  );

  handleGenerationFailures(config, result);

  return result;
}
