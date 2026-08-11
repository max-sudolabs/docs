import { describe, it, expect } from "vitest";
import path from "path";
import {
  normalizeVersion,
  stripVersionPrefix,
  isValidVersion,
  sortVersionsDescending,
  createFrontmatter,
  buildSDKPath,
} from "../lib/utils.js";
import { CONSTANTS } from "../lib/constants.js";

describe("normalizeVersion", () => {
  it("adds v prefix when missing", () => {
    expect(normalizeVersion("1.0.0")).toBe("v1.0.0");
    expect(normalizeVersion("2.5.3")).toBe("v2.5.3");
    expect(normalizeVersion("10.20.30")).toBe("v10.20.30");
  });

  it("keeps v prefix when already present", () => {
    expect(normalizeVersion("v1.0.0")).toBe("v1.0.0");
    expect(normalizeVersion("v2.5.3")).toBe("v2.5.3");
  });

  it("handles prerelease versions", () => {
    expect(normalizeVersion("1.0.0-beta.1")).toBe("v1.0.0-beta.1");
    expect(normalizeVersion("v1.0.0-rc.2")).toBe("v1.0.0-rc.2");
  });
});

describe("stripVersionPrefix", () => {
  it("removes v prefix when present", () => {
    expect(stripVersionPrefix("v1.0.0")).toBe("1.0.0");
    expect(stripVersionPrefix("v2.5.3")).toBe("2.5.3");
  });

  it("keeps version unchanged when no v prefix", () => {
    expect(stripVersionPrefix("1.0.0")).toBe("1.0.0");
    expect(stripVersionPrefix("10.20.30")).toBe("10.20.30");
  });

  it("only removes leading v", () => {
    expect(stripVersionPrefix("vvv1.0.0")).toBe("vv1.0.0");
    expect(stripVersionPrefix("1.0.0-v2")).toBe("1.0.0-v2");
  });
});

describe("isValidVersion", () => {
  it("accepts valid semver versions", () => {
    expect(isValidVersion("1.0.0")).toBe(true);
    expect(isValidVersion("v1.0.0")).toBe(true);
    expect(isValidVersion("v2.9.0")).toBe(true);
    expect(isValidVersion("10.20.30")).toBe(true);
    expect(isValidVersion("v0.0.1")).toBe(true);
  });

  it("accepts versions with prerelease tags", () => {
    expect(isValidVersion("1.0.0-beta")).toBe(true);
    expect(isValidVersion("v2.0.0-rc.1")).toBe(true);
    expect(isValidVersion("1.0.0-alpha.2.3")).toBe(true);
  });

  it("rejects non-semver strings", () => {
    expect(isValidVersion("main")).toBe(false);
    expect(isValidVersion("latest")).toBe(false);
    expect(isValidVersion("develop")).toBe(false);
    expect(isValidVersion("")).toBe(false);
  });

  it("rejects partial versions", () => {
    expect(isValidVersion("1.0")).toBe(false);
    expect(isValidVersion("1")).toBe(false);
    expect(isValidVersion("v1")).toBe(false);
  });
});

describe("sortVersionsDescending", () => {
  it("sorts versions from newest to oldest", () => {
    const versions = ["v1.0.0", "v2.0.0", "v1.5.0"];
    const result = sortVersionsDescending(versions);
    expect(result).toEqual(["v2.0.0", "v1.5.0", "v1.0.0"]);
  });

  it("handles versions without v prefix", () => {
    const versions = ["1.0.0", "2.0.0", "1.5.0"];
    const result = sortVersionsDescending(versions);
    expect(result).toEqual(["2.0.0", "1.5.0", "1.0.0"]);
  });

  it("handles mixed prefix versions", () => {
    const versions = ["v1.0.0", "2.0.0", "v1.5.0"];
    const result = sortVersionsDescending(versions);
    expect(result).toEqual(["2.0.0", "v1.5.0", "v1.0.0"]);
  });

  it("correctly sorts double-digit versions", () => {
    const versions = ["v1.9.0", "v1.10.0", "v1.2.0"];
    const result = sortVersionsDescending(versions);
    // semver sorts 1.10.0 > 1.9.0 > 1.2.0
    expect(result).toEqual(["v1.10.0", "v1.9.0", "v1.2.0"]);
  });

  it("handles empty array", () => {
    expect(sortVersionsDescending([])).toEqual([]);
  });

  it("handles single version", () => {
    expect(sortVersionsDescending(["v1.0.0"])).toEqual(["v1.0.0"]);
  });

  it("sorts prerelease versions correctly", () => {
    const versions = ["v1.0.0", "v1.0.0-beta.1", "v1.0.0-alpha"];
    const result = sortVersionsDescending(versions);
    // stable > beta > alpha
    expect(result).toEqual(["v1.0.0", "v1.0.0-beta.1", "v1.0.0-alpha"]);
  });

  it("uses string comparison fallback for invalid semver", () => {
    const versions = ["invalid", "also-invalid", "z-last"];
    const result = sortVersionsDescending(versions);
    // lexicographic descending
    expect(result).toEqual(["z-last", "invalid", "also-invalid"]);
  });
});

describe("createFrontmatter", () => {
  it("creates frontmatter with title", () => {
    const result = createFrontmatter("My Title");
    expect(result).toBe(`---
sidebarTitle: "My Title"
"og:image": "/images/og/sdk-reference.png"
"twitter:image": "/images/og/sdk-reference.png"
---

`);
  });

  it("handles empty title", () => {
    const result = createFrontmatter("");
    expect(result).toBe(`---
sidebarTitle: ""
"og:image": "/images/og/sdk-reference.png"
"twitter:image": "/images/og/sdk-reference.png"
---

`);
  });

  it("handles titles with special characters", () => {
    const result = createFrontmatter('Title "with" quotes');
    // the function doesn't escape - this is fine for most use cases
    expect(result).toContain('sidebarTitle: "Title "with" quotes"');
  });

  it("includes trailing newlines for content concatenation", () => {
    const result = createFrontmatter("Test");
    // should end with double newline for clean content concatenation
    expect(result.endsWith("\n\n")).toBe(true);
  });
});

describe("buildSDKPath", () => {
  it("builds correct path with all components", () => {
    const result = buildSDKPath("/docs", "js-sdk", "v1.0.0");
    expect(result).toBe(
      path.join("/docs", CONSTANTS.DOCS_SDK_REF_PATH, "js-sdk", "v1.0.0")
    );
  });

  it("uses DOCS_SDK_REF_PATH constant", () => {
    const result = buildSDKPath("/root", "test", "v2.0.0");
    expect(result).toContain("sdk-reference");
    expect(result).toContain("test");
    expect(result).toContain("v2.0.0");
  });

  it("handles nested docsDir paths", () => {
    const result = buildSDKPath("/home/user/project/docs", "cli", "v3.0.0");
    expect(result).toBe(
      path.join(
        "/home/user/project/docs",
        CONSTANTS.DOCS_SDK_REF_PATH,
        "cli",
        "v3.0.0"
      )
    );
  });

  it("handles SDK keys with hyphens", () => {
    const result = buildSDKPath("/docs", "code-interpreter-js-sdk", "v1.0.0");
    expect(result).toContain("code-interpreter-js-sdk");
  });
});
