import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { CONSTANTS } from "../lib/constants.js";
import { applyVersionBanner, syncVersionBanners } from "../lib/banner.js";
import type { NavigationDropdown } from "../types.js";

const PAGE = `---
sidebarTitle: "Sandbox"
"og:image": "/images/og/sdk-reference.png"
"twitter:image": "/images/og/sdk-reference.png"
---

### Sandbox
`;

const BANNER = "<Warning>\n  Old version.\n</Warning>";

describe("applyVersionBanner", () => {
  it("inserts the banner between the frontmatter and the body", () => {
    const result = applyVersionBanner(PAGE, BANNER);

    expect(result).toBe(`---
sidebarTitle: "Sandbox"
"og:image": "/images/og/sdk-reference.png"
"twitter:image": "/images/og/sdk-reference.png"
---

{/* version-banner:start */}
<Warning>
  Old version.
</Warning>
{/* version-banner:end */}

### Sandbox
`);
  });

  it("is idempotent when applied twice", () => {
    const once = applyVersionBanner(PAGE, BANNER);

    expect(applyVersionBanner(once, BANNER)).toBe(once);
  });

  it("replaces an existing banner rather than stacking one", () => {
    const once = applyVersionBanner(PAGE, BANNER);
    const twice = applyVersionBanner(once, "<Warning>\n  Newer text.\n</Warning>");

    expect(twice).toContain("Newer text.");
    expect(twice).not.toContain("Old version.");
    expect(twice.match(/version-banner:start/g)).toHaveLength(1);
  });

  it("restores the original page when the banner is removed", () => {
    expect(applyVersionBanner(applyVersionBanner(PAGE, BANNER), null)).toBe(PAGE);
  });

  it("leaves a page that never had a banner untouched", () => {
    expect(applyVersionBanner(PAGE, null)).toBe(PAGE);
  });

  it("preserves the blank lines the generator left after the frontmatter", () => {
    // Some generated pages carry several blank lines here. Reflowing them
    // would put thousands of unrelated lines in every sync diff.
    const padded = PAGE.replace("---\n\n### Sandbox", "---\n\n\n\n\n### Sandbox");
    const bannered = applyVersionBanner(padded, BANNER);

    expect(bannered).toContain("{/* version-banner:end */}\n\n\n\n\n### Sandbox");
    expect(applyVersionBanner(bannered, null)).toBe(padded);
  });

  it("returns content without frontmatter untouched", () => {
    const bare = "### Sandbox\n";

    expect(applyVersionBanner(bare, BANNER)).toBe(bare);
  });

  it("keeps an unrelated MDX comment in the body", () => {
    const page = PAGE.replace("### Sandbox", "{/* keep me */}\n\n### Sandbox");
    const result = applyVersionBanner(applyVersionBanner(page, BANNER), null);

    expect(result).toBe(page);
  });
});

describe("syncVersionBanners", () => {
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
            `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/errors`,
            `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/sandbox`,
          ],
        },
        {
          version: "v1.0.0 (TestJS)",
          default: false,
          pages: [
            `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/filesystem`,
            `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`,
          ],
        },
      ],
    },
  ];

  async function writePage(page: string, content = PAGE): Promise<void> {
    const file = path.join(tempDir, `${page}${CONSTANTS.MDX_EXTENSION}`);
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(file, content);
  }

  async function writeAll(): Promise<void> {
    for (const version of navigation[0].versions) {
      for (const page of version.pages) {
        await writePage(page);
      }
    }
  }

  async function readPage(page: string): Promise<string> {
    return fs.readFile(
      path.join(tempDir, `${page}${CONSTANTS.MDX_EXTENSION}`),
      "utf-8"
    );
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "banner-test-"));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it("banners superseded pages and leaves the default version clean", async () => {
    await writeAll();

    const result = await syncVersionBanners(navigation, tempDir);

    expect(result.bannered).toBe(2);
    expect(result.latest).toBe(2);
    expect(result.changed).toBe(2);

    expect(
      await readPage(`${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/sandbox`)
    ).not.toContain("version-banner");
  });

  it("links a superseded page to its own module under /latest/", async () => {
    await writeAll();

    await syncVersionBanners(navigation, tempDir);

    const old = await readPage(
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`
    );

    expect(old).toContain(
      "You are currently viewing documentation for version 1.0.0 of the E2B Test SDK (JavaScript)."
    );
    expect(old).toContain(
      `[View the latest version of this page](/${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/latest/sandbox).`
    );
    expect(old).not.toContain("does not exist in the latest version");
  });

  it("falls back to the newest version's first page when the module is gone", async () => {
    await writeAll();

    await syncVersionBanners(navigation, tempDir);

    const removed = await readPage(
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/filesystem`
    );

    expect(removed).toContain(
      "The `filesystem` module does not exist in the latest version."
    );
    expect(removed).toContain(
      `[View the latest version of this reference](/${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/latest/errors).`
    );
  });

  it("drops the v prefix so the copy reads \"version 1.0.0\"", async () => {
    await writeAll();

    await syncVersionBanners(navigation, tempDir);

    const old = await readPage(
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`
    );

    expect(old).toContain("version 1.0.0 of");
    expect(old).not.toContain("version v1.0.0");
  });

  it("puts the link in its own paragraph", async () => {
    await writeAll();

    await syncVersionBanners(navigation, tempDir);

    const old = await readPage(
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`
    );

    expect(old).toContain("(JavaScript).\n\n  [View the latest version");
  });

  it("never names the newest version, so a release does not rewrite the text", async () => {
    await writeAll();

    await syncVersionBanners(navigation, tempDir);

    const old = await readPage(
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`
    );

    expect(old).not.toContain("v2.0.0");
  });

  it("strips the banner from a version that becomes the newest", async () => {
    await writeAll();
    await syncVersionBanners(navigation, tempDir);

    const promoted: NavigationDropdown[] = [
      {
        ...navigation[0],
        versions: navigation[0].versions.map((v) => ({
          ...v,
          default: v.version.startsWith("v1.0.0"),
        })),
      },
    ];

    await syncVersionBanners(promoted, tempDir);

    expect(
      await readPage(`${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`)
    ).toBe(PAGE);
  });

  it("rewrites nothing on a second run", async () => {
    await writeAll();

    await syncVersionBanners(navigation, tempDir);
    const second = await syncVersionBanners(navigation, tempDir);

    expect(second.changed).toBe(0);
  });

  it("reports navigation pages that have no MDX file", async () => {
    await writePage(`${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/errors`);

    const result = await syncVersionBanners(navigation, tempDir);

    expect(result.missing).toEqual([
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v2.0.0/sandbox`,
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/filesystem`,
      `${CONSTANTS.DOCS_SDK_REF_PATH}/test-js-sdk/v1.0.0/sandbox`,
    ]);
  });

  it("skips a dropdown with no default version", async () => {
    await writeAll();

    const noDefault: NavigationDropdown[] = [
      {
        ...navigation[0],
        versions: navigation[0].versions.map((v) => ({ ...v, default: false })),
      },
    ];

    const result = await syncVersionBanners(noDefault, tempDir);

    expect(result.changed).toBe(0);
    expect(result.bannered).toBe(0);
  });
});
