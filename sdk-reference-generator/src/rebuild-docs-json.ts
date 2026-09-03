#!/usr/bin/env node

import path from "path";
import { fileURLToPath } from "url";
import { buildNavigation, mergeNavigation } from "./navigation.js";
import { syncIndexingDirectives } from "./lib/seo.js";
import { syncVersionBanners } from "./lib/banner.js";
import { verifyGeneratedDocs } from "./lib/verify.js";
import { log } from "./lib/log.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT_DIR = path.resolve(__dirname, "..");
const DOCS_DIR = path.resolve(SCRIPT_DIR, "..");

async function main(): Promise<void> {
  log.header("Rebuild docs.json from local SDK references");

  log.section("Building navigation");
  const navigation = await buildNavigation(DOCS_DIR);

  if (navigation.length === 0) {
    log.warn("No SDK references found locally");
    process.exit(1);
  }

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
    process.exit(1);
  }

  log.blank();
  log.success("docs.json rebuilt successfully");
  log.stats(
    [
      { label: "Total SDKs", value: verification.stats.totalSDKs },
      { label: "Total versions", value: verification.stats.totalVersions },
      { label: "Total MDX files", value: verification.stats.totalMdxFiles },
    ],
    0
  );
}

main().catch((error) => {
  log.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
