import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { CONSTANTS } from "../lib/constants.js";
import {
  applyNoindexDirective,
  syncIndexingDirectives,
} from "../lib/seo.js";
import type { NavigationDropdown } from "../types.js";

const PAGE = `---
sidebarTitle: "Sandbox"
"og:image": "/images/og/sdk-reference.png"
"twitter:image": "/images/og/sdk-reference.png"
---

# sandbox
`;

describe("applyNoindexDirective", () => {
  it("adds noindex to frontmatter", () => {
    const result = applyNoindexDirective(PAGE, true);

    expect(result).toContain("noindex: true");
    expect(result).toContain('sidebarTitle: "Sandbox"');
    expect(result).toContain("# sandbox");
  });

  it("keeps the frontmatter fence intact", () => {
    const result = applyNoindexDirective(PAGE, true);

    expect(result.startsWith("---\n")).toBe(true);
    expect(result.split("---").length).toBe(3);
  });

  it("is idempotent when applied twice", () => {
    const once = applyNoindexDirective(PAGE, true);
    const twice = applyNoindexDirective(once, true);

    expect(twice).toBe(once);
    expect(twice.match(/noindex/g)).toHaveLength(1);
  });

  it("removes noindex when the page becomes indexable", () => {
    const noindexed = applyNoindexDirective(PAGE, true);
    const restored = applyNoindexDirective(noindexed, false);

    expect(restored).toBe(PAGE);
  });

  it("leaves an already indexable page untouched", () => {
    expect(applyNoindexDirective(PAGE, false)).toBe(PAGE);
  });

  it("returns content without frontmatter untouched", () => {
    const bare = "# sandbox\n";

    expect(applyNoindexDirective(bare, true)).toBe(bare);
  });
});

describe("syncIndexingDirectives", () => {
  let tempDir: string;

  const navigation: NavigationDropdown[] = [
    {
      dropdown: "Test SDK (JavaScript)",
      icon: "square-js",
      versions: [
        {
          version: "v2.0.0 (TestJS)",
          default: true,
          pages: [
            `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/sandbox`,
            `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/errors`,
          ],
        },
        {
          version: "v1.0.0 (TestJS)",
          default: false,
          pages: [`${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`],
        },
      ],
    },
  ];

  async function writePage(page: string, content = PAGE): Promise<string> {
    const file = path.join(tempDir, `${page}${CONSTANTS.MDX_EXTENSION}`);
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(file, content);
    return file;
  }

  async function readPage(page: string): Promise<string> {
    return fs.readFile(
      path.join(tempDir, `${page}${CONSTANTS.MDX_EXTENSION}`),
      "utf-8"
    );
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seo-test-"));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it("noindexes older versions and leaves the default version indexable", async () => {
    for (const version of navigation[0].versions) {
      for (const page of version.pages) {
        await writePage(page);
      }
    }

    const result = await syncIndexingDirectives(navigation, tempDir);

    expect(result.indexable).toBe(2);
    expect(result.noindexed).toBe(1);
    expect(result.changed).toBe(1);

    const old = await readPage(
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`
    );
    const current = await readPage(
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/sandbox`
    );

    expect(old).toContain("noindex: true");
    expect(current).not.toContain("noindex");
  });

  it("strips noindex from a version that becomes the newest", async () => {
    const page = `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/sandbox`;
    await writePage(page, applyNoindexDirective(PAGE, true));
    await writePage(`${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/errors`);
    await writePage(`${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`);

    await syncIndexingDirectives(navigation, tempDir);

    expect(await readPage(page)).not.toContain("noindex");
  });

  it("rewrites nothing on a second run", async () => {
    for (const version of navigation[0].versions) {
      for (const page of version.pages) {
        await writePage(page);
      }
    }

    await syncIndexingDirectives(navigation, tempDir);
    const second = await syncIndexingDirectives(navigation, tempDir);

    expect(second.changed).toBe(0);
  });

  it("reports navigation pages that have no MDX file", async () => {
    await writePage(`${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/sandbox`);

    const result = await syncIndexingDirectives(navigation, tempDir);

    expect(result.missing).toEqual([
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/errors`,
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`,
    ]);
  });
});
