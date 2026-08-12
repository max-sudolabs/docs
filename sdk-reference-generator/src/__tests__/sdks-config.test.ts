import { describe, it, expect } from "vitest";
import sdks from "../../sdks.config.js";
import { resolveConfig } from "../lib/config.js";
import type { TypedocSDKConfig, PydocSDKConfig } from "../types.js";

describe("sdks.config - js-sdk version overrides", () => {
  const jsSdkConfig = sdks["js-sdk"] as TypedocSDKConfig;

  it("should use pty.ts for v1.0.0", () => {
    const resolved = resolveConfig(
      jsSdkConfig.defaultConfig,
      jsSdkConfig.configOverrides,
      "v1.0.0"
    );

    expect(resolved.entryPoints).toContain("src/sandbox/pty.ts");
    expect(resolved.entryPoints).not.toContain("src/sandbox/commands/index.ts");
    expect(resolved.entryPoints).not.toContain("src/template/index.ts");
  });

  it("should use commands.ts without template for v1.1.0 - v2.2.x", () => {
    const versions = ["v1.1.0", "v1.5.0", "v2.0.0", "v2.2.10"];

    for (const version of versions) {
      const resolved = resolveConfig(
        jsSdkConfig.defaultConfig,
        jsSdkConfig.configOverrides,
        version
      );

      expect(resolved.entryPoints).toContain("src/sandbox/commands/index.ts");
      expect(resolved.entryPoints).not.toContain("src/sandbox/pty.ts");
      expect(resolved.entryPoints).not.toContain("src/template/index.ts");
    }
  });

  it("should include template modules for v2.3.0+", () => {
    const versions = ["v2.3.0", "v2.5.0", "v2.10.1"];

    for (const version of versions) {
      const resolved = resolveConfig(
        jsSdkConfig.defaultConfig,
        jsSdkConfig.configOverrides,
        version
      );

      expect(resolved.entryPoints).toContain("src/sandbox/commands/index.ts");
      expect(resolved.entryPoints).toContain("src/template/index.ts");
      expect(resolved.entryPoints).toContain("src/template/readycmd.ts");
      expect(resolved.entryPoints).toContain("src/template/logger.ts");
      expect(resolved.entryPoints).not.toContain("src/sandbox/pty.ts");
    }
  });

  it("should have correct entry point counts per version range", () => {
    const v1_0_0 = resolveConfig(
      jsSdkConfig.defaultConfig,
      jsSdkConfig.configOverrides,
      "v1.0.0"
    );
    expect(v1_0_0.entryPoints).toHaveLength(5); // sandbox, filesystem, process, pty, errors

    const v1_5_0 = resolveConfig(
      jsSdkConfig.defaultConfig,
      jsSdkConfig.configOverrides,
      "v1.5.0"
    );
    expect(v1_5_0.entryPoints).toHaveLength(5); // sandbox, filesystem, process, commands, errors

    const v2_10_1 = resolveConfig(
      jsSdkConfig.defaultConfig,
      jsSdkConfig.configOverrides,
      "v2.10.1"
    );
    expect(v2_10_1.entryPoints).toHaveLength(8); // + 3 template modules
  });
});

describe("sdks.config - python-sdk version overrides", () => {
  const pythonSdkConfig = sdks["python-sdk"] as PydocSDKConfig;

  it("should only include basic sandbox packages for v1.0.0 - v2.0.x", () => {
    const versions = ["v1.0.0", "v1.5.0", "v2.0.0", "v2.0.3"];

    for (const version of versions) {
      const resolved = resolveConfig(
        pythonSdkConfig.defaultConfig,
        pythonSdkConfig.configOverrides,
        version
      );

      expect(resolved.allowedPackages).toContain("e2b.sandbox_sync");
      expect(resolved.allowedPackages).toContain("e2b.sandbox_async");
      expect(resolved.allowedPackages).toContain("e2b.exceptions");
      expect(resolved.allowedPackages).not.toContain("e2b.template");
      expect(resolved.allowedPackages).not.toContain("e2b.template_sync");
      expect(resolved.allowedPackages).toHaveLength(3);
    }
  });

  it("should include template packages for v2.1.0+", () => {
    const versions = ["v2.1.0", "v2.3.0", "v2.5.0", "v2.10.1"];

    for (const version of versions) {
      const resolved = resolveConfig(
        pythonSdkConfig.defaultConfig,
        pythonSdkConfig.configOverrides,
        version
      );

      expect(resolved.allowedPackages).toContain("e2b.sandbox_sync");
      expect(resolved.allowedPackages).toContain("e2b.sandbox_async");
      expect(resolved.allowedPackages).toContain("e2b.exceptions");
      expect(resolved.allowedPackages).toContain("e2b.template");
      expect(resolved.allowedPackages).toContain("e2b.template_sync");
      expect(resolved.allowedPackages).toContain("e2b.template_async");
      expect(resolved.allowedPackages).toContain("e2b.template.logger");
      expect(resolved.allowedPackages).toContain("e2b.template.readycmd");
      expect(resolved.allowedPackages).toHaveLength(8);
    }
  });

  it("should have correct package counts per version range", () => {
    const v1_5_0 = resolveConfig(
      pythonSdkConfig.defaultConfig,
      pythonSdkConfig.configOverrides,
      "v1.5.0"
    );
    expect(v1_5_0.allowedPackages).toHaveLength(3); // basic sandbox packages only

    const v2_10_1 = resolveConfig(
      pythonSdkConfig.defaultConfig,
      pythonSdkConfig.configOverrides,
      "v2.10.1"
    );
    expect(v2_10_1.allowedPackages).toHaveLength(8); // + 5 template packages
  });
});

describe("versionLabel", () => {
  it("is set for every SDK", () => {
    for (const [key, config] of Object.entries(sdks)) {
      expect(config.versionLabel, `${key} is missing versionLabel`).toBeTruthy();
    }
  });

  it("is unique across SDKs", () => {
    // Mintlify's dropdown switcher resolves by version label alone, so two SDKs
    // sharing a label would cross-wire their destinations. This is the property
    // the whole workaround depends on.
    const labels = Object.values(sdks).map((c) => c.versionLabel);
    const duplicates = labels.filter((l, i) => labels.indexOf(l) !== i);

    expect(duplicates, `duplicate versionLabel(s): ${duplicates.join(", ")}`).toEqual([]);
  });
});
