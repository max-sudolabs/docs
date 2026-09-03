#!/usr/bin/env node

import { Command } from "commander";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import sdks from "../sdks.config.js";
import { generateSDK } from "./generator.js";
import { buildNavigation, mergeNavigation } from "./navigation.js";
import { syncIndexingDirectives } from "./lib/seo.js";
import { syncVersionBanners } from "./lib/banner.js";
import { verifyGeneratedDocs } from "./lib/verify.js";
import { log } from "./lib/log.js";
import type { GenerationContext, GenerationResult } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT_DIR = path.resolve(__dirname, "..");
const DOCS_DIR = path.resolve(SCRIPT_DIR, "..");
const CONFIGS_DIR = path.join(SCRIPT_DIR, "configs");

const program = new Command()
  .name("generate-sdk-reference")
  .description("Generate SDK reference documentation")
  .option("--sdk <name>", 'SDK to generate (or "all")', "all")
  .option(
    "--version <version>",
    'Version to generate (or "all", "latest")',
    "all"
  )
  .option("--limit <n>", "Limit number of versions to generate", parseInt)
  .option("--force", "Force regenerate existing versions")
  .parse();

const opts = program.opts<{
  sdk: string;
  version: string;
  limit?: number;
  force?: boolean;
}>();

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sdk-gen-"));

  log.header("SDK Reference Generator");
  log.stats([
    { label: "SDK", value: opts.sdk },
    { label: "Version", value: opts.version },
    ...(opts.limit
      ? [{ label: "Limit", value: `${opts.limit} versions` }]
      : []),
    ...(opts.force ? [{ label: "Force", value: "true" }] : []),
    { label: "Temp", value: tempDir },
  ]);
  log.blank();

  const context: GenerationContext = {
    tempDir,
    docsDir: DOCS_DIR,
    configsDir: CONFIGS_DIR,
    limit: opts.limit,
    force: opts.force,
  };

  try {
    const sdkKeys = opts.sdk === "all" ? Object.keys(sdks) : [opts.sdk];

    const results: Map<string, GenerationResult> = new Map();

    for (const sdkKey of sdkKeys) {
      log.section(`Generating ${sdkKey}`);
      const result = await generateSDK(sdkKey, opts.version, context);
      results.set(sdkKey, result);
    }

    log.blank();
    log.section("Building navigation");
    const navigation = await buildNavigation(DOCS_DIR);

    log.blank();
    log.section("Applying indexing directives");
    await syncIndexingDirectives(navigation, DOCS_DIR);

    log.blank();
    log.section("Applying version banners");
    await syncVersionBanners(navigation, DOCS_DIR);

    log.blank();
    log.section("Merging into docs.json");
    await mergeNavigation(navigation, DOCS_DIR);

    log.blank();
    log.section("Verifying documentation");
    const verification = await verifyGeneratedDocs(DOCS_DIR);

    if (verification.warnings.length > 0) {
      log.warn("Warnings detected:");
      for (const warning of verification.warnings) {
        log.data(`- ${warning}`, 1);
      }
    }

    if (!verification.valid) {
      log.blank();
      log.error("Verification failed:");
      for (const error of verification.errors) {
        log.data(`- ${error}`, 1);
      }
      if (!verification.docsJsonValid) {
        log.error("docs.json validation failed");
      }
      throw new Error("Documentation verification failed");
    }

    log.blank();
    log.success("SDK reference generation complete");

    let totalGenerated = 0;
    let totalFailed = 0;

    for (const [sdkKey, result] of results) {
      totalGenerated += result.generated;
      totalFailed += result.failed;
    }

    log.blank();
    log.summary("Final Summary");
    log.stats(
      [
        { label: "Generated", value: totalGenerated },
        ...(totalFailed > 0 ? [{ label: "Failed", value: totalFailed }] : []),
        { label: "Total MDX files", value: verification.stats.totalMdxFiles },
        { label: "Total SDKs", value: verification.stats.totalSDKs },
        { label: "Total versions", value: verification.stats.totalVersions },
      ],
      0
    );
  } finally {
    await fs.remove(tempDir);
  }
}

main().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
