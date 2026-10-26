import { execa } from "execa";
import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import { CONSTANTS } from "../lib/constants.js";
import { log } from "../lib/log.js";

/**
 * The CLI's own Markdown export stringifies object defaults ("[default: [object Object]]",
 * e.g. the repeatable --env option). Drops those annotations; real defaults are kept.
 */
export function cleanCliMarkdown(content: string): string {
  return content.replace(/ ?\[default: \[object Object\]\]/g, "");
}

async function findCliOutputDir(sdkDir: string): Promise<string | null> {
  const possibleDirs = ["sdk_ref", "api_ref"];

  for (const dir of possibleDirs) {
    const fullPath = path.join(sdkDir, dir);
    if (await fs.pathExists(fullPath)) {
      const mdFiles = await glob(`*${CONSTANTS.MD_EXTENSION}`, {
        cwd: fullPath,
      });
      if (mdFiles.length > 0) {
        log.info(`Found CLI docs in ${dir}/`, 1);
        return fullPath;
      }
    }
  }

  return null;
}

export async function generateCli(sdkDir: string): Promise<string> {
  log.info("Building CLI...", 1);

  try {
    await execa("pnpm", ["run", "build"], {
      cwd: sdkDir,
      stdio: "inherit",
    });
  } catch (error) {
    log.warn("pnpm build failed, trying tsup...", 1);
    await execa("npx", ["tsup"], {
      cwd: sdkDir,
      stdio: "inherit",
    });
  }

  log.info("Generating documentation...", 1);

  await execa("node", ["dist/index.js", "-cmd2md"], {
    cwd: sdkDir,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "inherit",
  });

  const outputDir = await findCliOutputDir(sdkDir);

  if (!outputDir) {
    throw new Error(
      "CLI generator did not create any markdown files in sdk_ref/ or api_ref/"
    );
  }

  const mdFiles = await glob(`*${CONSTANTS.MD_EXTENSION}`, { cwd: outputDir });

  for (const file of mdFiles) {
    const srcPath = path.join(outputDir, file);
    const destPath = srcPath.replace(
      CONSTANTS.MD_EXTENSION,
      CONSTANTS.MDX_EXTENSION
    );
    const content = await fs.readFile(srcPath, "utf-8");
    await fs.writeFile(destPath, cleanCliMarkdown(content));
    await fs.remove(srcPath);
  }

  return outputDir;
}
