import { execa } from "execa";
import type { GeneratorType, InstallResult } from "../types.js";
import { log } from "./log.js";

/**
 * Builds the workspace packages the SDK depends on (e.g. @e2b/dockerfile-utils),
 * whose types resolve from their dist/ and are missing after a bare install.
 * Best-effort: a failure here surfaces as the real error in the SDK step.
 */
async function buildWorkspaceDependencies(sdkDir: string): Promise<void> {
  log.info("Building workspace dependencies...", 1);
  try {
    await execa(
      "pnpm",
      ["--filter", "{.}^...", "run", "--if-present", "build"],
      { cwd: sdkDir, stdio: "inherit" }
    );
  } catch {
    log.warn("Workspace dependency build failed, continuing...", 1);
  }
}

export async function installDependencies(
  sdkDir: string,
  generator: GeneratorType
): Promise<InstallResult> {
  log.info("Installing dependencies...", 1);

  switch (generator) {
    case "typedoc":
    case "cli": {
      const isTypedoc = generator === "typedoc";
      const pnpmArgs = isTypedoc
        ? ["install", "--ignore-scripts", "--prefer-offline"]
        : ["install", "--prefer-offline"];

      try {
        await execa("pnpm", pnpmArgs, {
          cwd: sdkDir,
          stdio: "inherit",
        });
        await buildWorkspaceDependencies(sdkDir);
      } catch {
        log.warn("pnpm failed, falling back to npm...", 1);
        await execa(
          "npm",
          ["install", "--legacy-peer-deps", "--force", "--prefer-offline"],
          {
            cwd: sdkDir,
            stdio: "inherit",
          }
        );
      }
      return { usePoetryRun: false };
    }

    case "pydoc": {
      try {
        await execa("poetry", ["install", "--no-interaction"], {
          cwd: sdkDir,
          stdio: "inherit",
        });
        return { usePoetryRun: true };
      } catch {
        log.warn("poetry failed, falling back to pip...", 1);

        log.info("Installing SDK package from local directory...", 1);
        await execa("pip", ["install", "--break-system-packages", "."], {
          cwd: sdkDir,
          stdio: "inherit",
        });

        log.info("Installing pydoc-markdown...", 1);
        await execa(
          "pip",
          ["install", "--break-system-packages", "pydoc-markdown"],
          {
            cwd: sdkDir,
            stdio: "inherit",
          }
        );

        return { usePoetryRun: false };
      }
    }
  }
}
