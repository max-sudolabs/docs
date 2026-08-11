import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { CONSTANTS } from "../lib/constants.js";

// mock the sdks config before importing navigation
vi.mock("../../sdks.config.js", () => ({
  default: {
    "test-js-sdk": {
      displayName: "Test SDK (JavaScript)",
      icon: "square-js",
      order: 1,
      repo: "https://github.com/test/repo.git",
      tagPattern: "test@",
      tagFormat: "test@{version}",
      generator: "typedoc",
      required: true,
    },
    "test-py-sdk": {
      displayName: "Test SDK (Python)",
      icon: "python",
      order: 2,
      repo: "https://github.com/test/repo.git",
      tagPattern: "@test/python@",
      tagFormat: "@test/python@{version}",
      generator: "pydoc",
      required: false,
    },
  },
}));

// import after mocking
const { buildNavigation, mergeNavigation, buildLatestRedirects } = await import(
  "../navigation.js"
);

describe("buildNavigation", () => {
  let tempDir: string;
  let sdkRefDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nav-test-"));
    sdkRefDir = path.join(tempDir, CONSTANTS.DOCS_SDK_REF_PATH);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it("returns empty array when sdk-reference directory does not exist", async () => {
    const result = await buildNavigation(tempDir);

    expect(result).toEqual([]);
  });

  it("skips SDKs that have no directory", async () => {
    await fs.ensureDir(sdkRefDir);
    // don't create any SDK directories

    const result = await buildNavigation(tempDir);

    expect(result).toEqual([]);
  });

  it("skips SDKs with no valid versions", async () => {
    const sdkDir = path.join(sdkRefDir, "test-js-sdk");
    await fs.ensureDir(sdkDir);
    // create invalid version directories
    await fs.ensureDir(path.join(sdkDir, "main"));
    await fs.ensureDir(path.join(sdkDir, "latest"));

    const result = await buildNavigation(tempDir);

    expect(result).toEqual([]);
  });

  it("builds navigation for SDKs with valid versions", async () => {
    const sdkDir = path.join(sdkRefDir, "test-js-sdk");
    const versionDir = path.join(sdkDir, "v1.0.0");
    await fs.ensureDir(versionDir);
    await fs.writeFile(
      path.join(versionDir, "Sandbox.mdx"),
      '---\nsidebarTitle: "Sandbox"\n---\n\n# Content'
    );

    const result = await buildNavigation(tempDir);

    expect(result).toHaveLength(1);
    expect(result[0].dropdown).toBe("Test SDK (JavaScript)");
    expect(result[0].icon).toBe("square-js");
    expect(result[0].versions).toHaveLength(1);
    expect(result[0].versions[0].version).toBe("v1.0.0");
    expect(result[0].versions[0].default).toBe(true);
    expect(result[0].versions[0].pages).toContain(
      "sdk-reference/test-js-sdk/v1.0.0/Sandbox"
    );
  });

  it("sorts versions descending (latest first)", async () => {
    const sdkDir = path.join(sdkRefDir, "test-js-sdk");

    // create multiple versions
    for (const version of ["v1.0.0", "v2.0.0", "v1.5.0"]) {
      const versionDir = path.join(sdkDir, version);
      await fs.ensureDir(versionDir);
      await fs.writeFile(
        path.join(versionDir, "Test.mdx"),
        '---\nsidebarTitle: "Test"\n---\n\n# Content'
      );
    }

    const result = await buildNavigation(tempDir);

    expect(result[0].versions[0].version).toBe("v2.0.0");
    expect(result[0].versions[1].version).toBe("v1.5.0");
    expect(result[0].versions[2].version).toBe("v1.0.0");
  });

  it("marks first version as default", async () => {
    const sdkDir = path.join(sdkRefDir, "test-js-sdk");

    for (const version of ["v1.0.0", "v2.0.0"]) {
      const versionDir = path.join(sdkDir, version);
      await fs.ensureDir(versionDir);
      await fs.writeFile(path.join(versionDir, "Test.mdx"), "# Content");
    }

    const result = await buildNavigation(tempDir);

    expect(result[0].versions[0].default).toBe(true);
    expect(result[0].versions[1].default).toBe(false);
  });

  it("normalizes versions without v prefix", async () => {
    const sdkDir = path.join(sdkRefDir, "test-js-sdk");
    const versionDir = path.join(sdkDir, "1.0.0"); // no "v" prefix
    await fs.ensureDir(versionDir);
    await fs.writeFile(path.join(versionDir, "Test.mdx"), "# Content");

    const result = await buildNavigation(tempDir);

    expect(result[0].versions[0].version).toBe("v1.0.0");
  });

  it("sorts SDKs by order from config", async () => {
    // create both SDKs
    for (const sdk of ["test-js-sdk", "test-py-sdk"]) {
      const versionDir = path.join(sdkRefDir, sdk, "v1.0.0");
      await fs.ensureDir(versionDir);
      await fs.writeFile(path.join(versionDir, "Test.mdx"), "# Content");
    }

    const result = await buildNavigation(tempDir);

    expect(result).toHaveLength(2);
    expect(result[0].dropdown).toBe("Test SDK (JavaScript)"); // order: 1
    expect(result[1].dropdown).toBe("Test SDK (Python)"); // order: 2
  });

  it("builds correct page paths with multiple modules", async () => {
    const versionDir = path.join(sdkRefDir, "test-js-sdk", "v1.0.0");
    await fs.ensureDir(versionDir);
    await fs.writeFile(path.join(versionDir, "Sandbox.mdx"), "# Sandbox");
    await fs.writeFile(path.join(versionDir, "Filesystem.mdx"), "# Filesystem");
    await fs.writeFile(path.join(versionDir, "Commands.mdx"), "# Commands");

    const result = await buildNavigation(tempDir);

    const pages = result[0].versions[0].pages;
    expect(pages).toHaveLength(3);
    // pages should be sorted alphabetically
    expect(pages[0]).toBe("sdk-reference/test-js-sdk/v1.0.0/Commands");
    expect(pages[1]).toBe("sdk-reference/test-js-sdk/v1.0.0/Filesystem");
    expect(pages[2]).toBe("sdk-reference/test-js-sdk/v1.0.0/Sandbox");
  });

  it("ignores non-mdx files in version directories", async () => {
    const versionDir = path.join(sdkRefDir, "test-js-sdk", "v1.0.0");
    await fs.ensureDir(versionDir);
    await fs.writeFile(path.join(versionDir, "Valid.mdx"), "# Valid");
    await fs.writeFile(path.join(versionDir, "readme.md"), "# Readme");
    await fs.writeFile(path.join(versionDir, "config.json"), "{}");

    const result = await buildNavigation(tempDir);

    expect(result[0].versions[0].pages).toHaveLength(1);
    expect(result[0].versions[0].pages[0]).toContain("Valid");
  });

  it("filters out invalid version directories", async () => {
    const sdkDir = path.join(sdkRefDir, "test-js-sdk");

    // valid versions
    await fs.ensureDir(path.join(sdkDir, "v1.0.0"));
    await fs.writeFile(path.join(sdkDir, "v1.0.0", "Test.mdx"), "# Content");

    // invalid versions
    await fs.ensureDir(path.join(sdkDir, "main"));
    await fs.writeFile(path.join(sdkDir, "main", "Test.mdx"), "# Content");
    await fs.ensureDir(path.join(sdkDir, "latest"));
    await fs.writeFile(path.join(sdkDir, "latest", "Test.mdx"), "# Content");

    const result = await buildNavigation(tempDir);

    expect(result[0].versions).toHaveLength(1);
    expect(result[0].versions[0].version).toBe("v1.0.0");
  });
});

describe("buildLatestRedirects", () => {
  it("returns no redirects for empty navigation", () => {
    expect(buildLatestRedirects([])).toEqual([]);
  });

  it("builds a wildcard redirect pointing latest at the default version", () => {
    const navigation = [
      {
        dropdown: "Test SDK",
        icon: "square-js",
        versions: [
          {
            version: "v2.0.0",
            default: true,
            pages: ["sdk-reference/test-js-sdk/v2.0.0/sandbox"],
          },
          {
            version: "v1.0.0",
            default: false,
            pages: ["sdk-reference/test-js-sdk/v1.0.0/sandbox"],
          },
        ],
      },
    ];

    const redirects = buildLatestRedirects(navigation);

    expect(redirects).toEqual([
      {
        source: "/sdk-reference/test-js-sdk/latest/:slug*",
        destination: "/sdk-reference/test-js-sdk/v2.0.0/:slug*",
        permanent: false,
      },
    ]);
  });

  it("emits one redirect per SDK dropdown", () => {
    const navigation = [
      {
        dropdown: "JS",
        icon: "square-js",
        versions: [
          {
            version: "v2.0.0",
            default: true,
            pages: ["sdk-reference/js-sdk/v2.0.0/sandbox"],
          },
        ],
      },
      {
        dropdown: "Py",
        icon: "python",
        versions: [
          {
            version: "v3.0.0",
            default: true,
            pages: ["sdk-reference/python-sdk/v3.0.0/sandbox_sync"],
          },
        ],
      },
    ];

    const redirects = buildLatestRedirects(navigation);

    expect(redirects.map((r) => r.source)).toEqual([
      "/sdk-reference/js-sdk/latest/:slug*",
      "/sdk-reference/python-sdk/latest/:slug*",
    ]);
  });

  it("skips dropdowns without a default version or pages", () => {
    const navigation = [
      {
        dropdown: "No default",
        icon: "square-js",
        versions: [
          {
            version: "v1.0.0",
            default: false,
            pages: ["sdk-reference/test-js-sdk/v1.0.0/sandbox"],
          },
        ],
      },
      {
        dropdown: "No pages",
        icon: "python",
        versions: [{ version: "v1.0.0", default: true, pages: [] }],
      },
    ];

    expect(buildLatestRedirects(navigation)).toEqual([]);
  });
});

describe("mergeNavigation", () => {
  let tempDir: string;
  let docsJsonPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "merge-nav-test-"));
    docsJsonPath = path.join(tempDir, "docs.json");
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it("throws when docs.json does not exist", async () => {
    const navigation = [
      {
        dropdown: "Test SDK",
        icon: "square-js",
        versions: [{ version: "v1.0.0", default: true, pages: ["test"] }],
      },
    ];

    await expect(mergeNavigation(navigation, tempDir)).rejects.toThrow(
      "docs.json not found"
    );
  });

  it("throws when docs.json has no anchors", async () => {
    await fs.writeJSON(docsJsonPath, { navigation: {} });

    const navigation = [
      {
        dropdown: "Test SDK",
        icon: "square-js",
        versions: [{ version: "v1.0.0", default: true, pages: ["test"] }],
      },
    ];

    await expect(mergeNavigation(navigation, tempDir)).rejects.toThrow(
      "No anchors found"
    );
  });

  it("creates new SDK Reference anchor when missing", async () => {
    await fs.writeJSON(docsJsonPath, {
      navigation: {
        anchors: [{ anchor: "Documentation", groups: [] }],
      },
    });

    const navigation = [
      {
        dropdown: "Test SDK",
        icon: "square-js",
        versions: [{ version: "v1.0.0", default: true, pages: ["test/page"] }],
      },
    ];

    await mergeNavigation(navigation, tempDir);

    const result = await fs.readJSON(docsJsonPath);
    expect(result.navigation.anchors).toHaveLength(2);
    expect(result.navigation.anchors[1].anchor).toBe("SDK Reference");
    expect(result.navigation.anchors[1].dropdowns).toHaveLength(1);
  });

  it("updates existing SDK Reference anchor", async () => {
    await fs.writeJSON(docsJsonPath, {
      navigation: {
        anchors: [
          { anchor: "Documentation", groups: [] },
          { anchor: "SDK Reference", icon: "brackets-curly", dropdowns: [] },
        ],
      },
    });

    const navigation = [
      {
        dropdown: "Test SDK",
        icon: "square-js",
        versions: [{ version: "v1.0.0", default: true, pages: ["test/page"] }],
      },
    ];

    await mergeNavigation(navigation, tempDir);

    const result = await fs.readJSON(docsJsonPath);
    expect(result.navigation.anchors).toHaveLength(2);
    expect(result.navigation.anchors[1].dropdowns).toHaveLength(1);
    expect(result.navigation.anchors[1].dropdowns[0].dropdown).toBe("Test SDK");
  });

  it("preserves other anchors in docs.json", async () => {
    await fs.writeJSON(docsJsonPath, {
      navigation: {
        anchors: [
          { anchor: "Documentation", groups: ["group1"] },
          { anchor: "API Reference", groups: ["group2"] },
        ],
      },
    });

    const navigation = [
      {
        dropdown: "Test SDK",
        icon: "square-js",
        versions: [{ version: "v1.0.0", default: true, pages: ["test/page"] }],
      },
    ];

    await mergeNavigation(navigation, tempDir);

    const result = await fs.readJSON(docsJsonPath);
    expect(result.navigation.anchors).toHaveLength(3);
    expect(result.navigation.anchors[0].anchor).toBe("Documentation");
    expect(result.navigation.anchors[0].groups).toEqual(["group1"]);
    expect(result.navigation.anchors[1].anchor).toBe("API Reference");
  });

  it("filters out SDKs with empty versions", async () => {
    await fs.writeJSON(docsJsonPath, {
      navigation: { anchors: [] },
    });

    const navigation = [
      {
        dropdown: "Valid SDK",
        icon: "square-js",
        versions: [{ version: "v1.0.0", default: true, pages: ["page"] }],
      },
      {
        dropdown: "Empty SDK",
        icon: "python",
        versions: [],
      },
    ];

    await mergeNavigation(navigation, tempDir);

    const result = await fs.readJSON(docsJsonPath);
    const sdkRefAnchor = result.navigation.anchors.find(
      (a: { anchor: string }) => a.anchor === "SDK Reference"
    );
    expect(sdkRefAnchor.dropdowns).toHaveLength(1);
    expect(sdkRefAnchor.dropdowns[0].dropdown).toBe("Valid SDK");
  });

  it("does not modify docs.json when no valid SDK versions exist", async () => {
    const originalContent = {
      navigation: {
        anchors: [{ anchor: "Documentation", groups: [] }],
      },
    };
    await fs.writeJSON(docsJsonPath, originalContent);

    const navigation = [
      { dropdown: "Empty SDK", icon: "square-js", versions: [] },
    ];

    await mergeNavigation(navigation, tempDir);

    const result = await fs.readJSON(docsJsonPath);
    expect(result).toEqual(originalContent);
  });

  it("writes JSON with proper formatting (2 spaces)", async () => {
    await fs.writeJSON(docsJsonPath, {
      navigation: { anchors: [] },
    });

    const navigation = [
      {
        dropdown: "Test SDK",
        icon: "square-js",
        versions: [{ version: "v1.0.0", default: true, pages: ["page"] }],
      },
    ];

    await mergeNavigation(navigation, tempDir);

    const content = await fs.readFile(docsJsonPath, "utf-8");
    // check for 2-space indentation
    expect(content).toContain('  "navigation"');
  });

  it("refreshes latest redirects while preserving manual ones", async () => {
    await fs.writeJSON(docsJsonPath, {
      navigation: { anchors: [] },
      redirects: [
        // a manual redirect that must survive
        { source: "/old", destination: "/new", permanent: true },
        // a stale latest redirect pointing at an old version
        {
          source: "/sdk-reference/test-js-sdk/latest/:slug*",
          destination: "/sdk-reference/test-js-sdk/v1.0.0/:slug*",
          permanent: false,
        },
      ],
    });

    const navigation = [
      {
        dropdown: "Test SDK",
        icon: "square-js",
        versions: [
          {
            version: "v2.0.0",
            default: true,
            pages: ["sdk-reference/test-js-sdk/v2.0.0/sandbox"],
          },
        ],
      },
    ];

    await mergeNavigation(navigation, tempDir);

    const result = await fs.readJSON(docsJsonPath);
    expect(result.redirects).toEqual([
      { source: "/old", destination: "/new", permanent: true },
      {
        source: "/sdk-reference/test-js-sdk/latest/:slug*",
        destination: "/sdk-reference/test-js-sdk/v2.0.0/:slug*",
        permanent: false,
      },
    ]);
  });

  it("ensures newline at end of file", async () => {
    await fs.writeJSON(docsJsonPath, {
      navigation: { anchors: [] },
    });

    const navigation = [
      {
        dropdown: "Test SDK",
        icon: "square-js",
        versions: [{ version: "v1.0.0", default: true, pages: ["page"] }],
      },
    ];

    await mergeNavigation(navigation, tempDir);

    const content = await fs.readFile(docsJsonPath, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
  });
});
