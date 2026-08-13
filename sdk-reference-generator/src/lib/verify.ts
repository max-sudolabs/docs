import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import { CONSTANTS } from './constants.js';
import { log } from './log.js';

export interface VerificationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalMdxFiles: number;
    totalSDKs: number;
    totalVersions: number;
  };
  docsJsonValid: boolean;
}

export async function verifyGeneratedDocs(
  docsDir: string
): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = { totalMdxFiles: 0, totalSDKs: 0, totalVersions: 0 };

  const sdkRefDir = path.join(docsDir, CONSTANTS.DOCS_SDK_REF_PATH);

  if (!(await fs.pathExists(sdkRefDir))) {
    errors.push('SDK reference directory does not exist');
    return { valid: false, errors, warnings, stats, docsJsonValid: false };
  }

  const sdkDirs = await fs.readdir(sdkRefDir, { withFileTypes: true });

  for (const sdkEntry of sdkDirs) {
    if (!sdkEntry.isDirectory()) continue;

    stats.totalSDKs++;
    const sdkPath = path.join(sdkRefDir, sdkEntry.name);
    const versionDirs = await fs.readdir(sdkPath, { withFileTypes: true });

    for (const versionEntry of versionDirs) {
      if (!versionEntry.isDirectory()) continue;
      if (!/^v?\d+\.\d+\.\d+/.test(versionEntry.name)) continue;

      stats.totalVersions++;
      const versionPath = path.join(sdkPath, versionEntry.name);

      const mdxFiles = await glob(`*${CONSTANTS.MDX_EXTENSION}`, {
        cwd: versionPath,
      });

      if (mdxFiles.length === 0) {
        warnings.push(
          `${sdkEntry.name}/${versionEntry.name} has no MDX files`
        );
        continue;
      }

      for (const file of mdxFiles) {
        const filePath = path.join(versionPath, file);
        const stat = await fs.stat(filePath);

        if (stat.size === 0) {
          errors.push(
            `Empty file: ${sdkEntry.name}/${versionEntry.name}/${file}`
          );
        } else {
          stats.totalMdxFiles++;

          const content = await fs.readFile(filePath, 'utf-8');
          if (!content.startsWith('---')) {
            errors.push(
              `Missing frontmatter: ${sdkEntry.name}/${versionEntry.name}/${file}`
            );
          }

          const fenceLineCount = content
            .split('\n')
            .filter((line) => line.startsWith('```')).length;
          if (fenceLineCount % 2 !== 0) {
            warnings.push(
              `Unbalanced code fences: ${sdkEntry.name}/${versionEntry.name}/${file}`
            );
          }
        }
      }
    }
  }

  // verify docs.json
  const docsJsonValid = await verifyDocsJson(docsDir);

  return {
    valid: errors.length === 0 && docsJsonValid,
    errors,
    warnings,
    stats,
    docsJsonValid,
  };
}

async function verifyDocsJson(docsDir: string): Promise<boolean> {
  const docsJsonPath = path.join(docsDir, 'docs.json');

  if (!(await fs.pathExists(docsJsonPath))) {
    log.error('docs.json not found');
    return false;
  }

  try {
    const docsJson = await fs.readJSON(docsJsonPath);

    const tabs = docsJson.navigation?.tabs;
    const anchors = docsJson.navigation?.anchors;
    const usesTabs = Array.isArray(tabs);
    const sections = usesTabs ? tabs : anchors;
    const labelKey = usesTabs ? 'tab' : 'anchor';

    if (!Array.isArray(sections)) {
      log.error('Invalid docs.json: navigation.tabs or navigation.anchors must be an array');
      return false;
    }

    const sdkRefSection = sections.find(
      (section: Record<string, unknown>) =>
        section[labelKey] === CONSTANTS.SDK_REFERENCE_ANCHOR
    );

    if (!sdkRefSection) {
      log.error(`${CONSTANTS.SDK_REFERENCE_ANCHOR} ${labelKey} not found in docs.json`);
      return false;
    }

    if (!Array.isArray(sdkRefSection.dropdowns)) {
      log.error(`SDK Reference ${labelKey} has no dropdowns array`);
      return false;
    }

    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`Failed to parse docs.json: ${msg}`);
    return false;
  }
}
