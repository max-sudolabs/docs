import { execa } from "execa";
import fs from "fs-extra";
import path from "path";
import { CONSTANTS } from "../lib/constants.js";
import { log } from "../lib/log.js";
import type { PydocConfig } from "../types.js";

const FENCE = /^```/;

/**
 * Closes a code fence that a docstring opens and never closes (e.g. an `@example`
 * block): the fence ends before the next Markdown heading (or module title such as
 * "# e2b.sandbox_sync.main"), and at the end of the file.
 */
export function closeUnterminatedFences(content: string): string {
  const out: string[] = [];
  let inFence = false;

  for (const line of content.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
    } else if (
      inFence &&
      (/^#{2,4} \S/.test(line) || /^# [A-Za-z_]\w*(\.\w+)+\s*$/.test(line))
    ) {
      // a heading cannot sit inside a docstring example: the example was not closed
      while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
      out.push("```", "");
      inFence = false;
    }
    out.push(line);
  }

  if (inFence) out.push("```");
  return out.join("\n");
}

/**
 * Removes the module title lines ("# e2b.sandbox_sync") outside code fences only, so
 * column-0 comments in docstring examples ("# Returns True") are kept.
 */
export function removeTitleLines(content: string): string {
  let inFence = false;
  return content
    .split("\n")
    .filter((line) => {
      if (FENCE.test(line)) inFence = !inFence;
      return inFence || !line.startsWith("# ");
    })
    .join("\n");
}

/**
 * pydoc-markdown leaves a whole Sphinx field block raw when one field is malformed
 * (":param pid Process ID" without the colon). Converts each run of ":param" lines
 * into the "**Arguments**:" list it produces for well-formed docstrings.
 */
export function convertRawParamFields(content: string): string {
  const lines = content.split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) inFence = !inFence;
    if (inFence || !/^\s*:param\s/.test(lines[i])) {
      out.push(lines[i]);
      continue;
    }

    out.push("**Arguments**:", "");
    while (i < lines.length && /^\s*:param\s/.test(lines[i])) {
      const m = lines[i].match(/^\s*:param\s+([A-Za-z_][\w.]*):?\s*(.*)$/);
      out.push(m ? `- \`${m[1]}\`: ${m[2]}` : lines[i]);
      i++;
    }
    i--;
  }

  return out.join("\n");
}

export function processPydocMarkdown(content: string): string {
  content = content.replace(/<a[^>]*>.*?<\/a>/g, "");
  content = closeUnterminatedFences(content);
  content = removeTitleLines(content);
  content = content.replace(/^(## .+) Objects$/gm, "$1");
  content = content.replace(/^####/gm, "###");
  content = convertRawParamFields(content);
  return content;
}

async function processMdx(file: string): Promise<void> {
  const content = await fs.readFile(file, "utf-8");
  await fs.writeFile(file, processPydocMarkdown(content));
}

async function processPackage(
  pkg: string,
  sdkDir: string,
  usePoetryRun: boolean
): Promise<boolean> {
  const rawName = pkg.split(".").pop() || pkg;
  const name = rawName.replace(/^e2b_/, "");

  log.step(`Processing ${pkg}`, 2);

  const outputFile = path.join(
    sdkDir,
    CONSTANTS.SDK_REF_DIR,
    `${name}${CONSTANTS.MDX_EXTENSION}`
  );

  try {
    const cmd = usePoetryRun ? "poetry" : "pydoc-markdown";
    const args = usePoetryRun
      ? ["run", "pydoc-markdown", "-p", pkg]
      : ["-p", pkg];

    const result = await execa(cmd, args, {
      cwd: sdkDir,
      stdio: "pipe",
    });

    const rawContent = result.stdout.trim();
    if (rawContent.length < 50) {
      log.warn(`${pkg} generated no content - skipping`, 2);
      return false;
    }

    await fs.writeFile(outputFile, result.stdout);
    await processMdx(outputFile);

    const stat = await fs.stat(outputFile);
    if (stat.size < 100) {
      log.warn(`${pkg} has no meaningful content - removing`, 2);
      await fs.remove(outputFile);
      return false;
    }

    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.warn(`Failed to generate docs for ${pkg}: ${msg}`, 2);
    await fs.remove(outputFile);
    return false;
  }
}

export async function generatePydoc(
  sdkDir: string,
  resolvedConfig: PydocConfig,
  usePoetryRun: boolean
): Promise<string> {
  const { allowedPackages } = resolvedConfig;
  const outputDir = path.join(sdkDir, CONSTANTS.SDK_REF_DIR);
  await fs.ensureDir(outputDir);

  log.info(
    `Attempting to generate docs for ${allowedPackages.length} packages`,
    1
  );
  log.data(`Packages: ${allowedPackages.join(", ")}`, 1);

  let successful = 0;
  for (const pkg of allowedPackages) {
    const result = await processPackage(pkg, sdkDir, usePoetryRun);
    if (result) successful++;
  }

  log.step(
    `Generated docs for ${successful}/${allowedPackages.length} packages`,
    1
  );

  return outputDir;
}
