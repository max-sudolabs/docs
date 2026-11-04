import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import fs from "fs-extra";
import os from "os";
import path from "path";

const RENDER_SCRIPT = path.resolve(__dirname, "../../configs/pydoc_render.py");

const files: Record<string, string> = {
  "pkg/__init__.py": "",
  "pkg/base.py": [
    "class Base:",
    "    def inherited(self):",
    '        """Defined on Base."""',
    "",
    "    def overridden(self):",
    '        """Base version."""',
    "",
    "    def _private(self):",
    '        """Private."""',
  ].join("\n"),
  "pkg/impl.py": [
    "from pkg.base import Base",
    "",
    "class Impl(Base):",
    "    def own(self):",
    '        """Defined on Impl."""',
    "",
    "    def overridden(self):",
    '        """Impl version."""',
  ].join("\n"),
  "pkg/page.py": [
    "class Parent:",
    "    def shared(self):",
    '        """Defined on Parent."""',
    "",
    "class Child(Parent):",
    "    pass",
  ].join("\n"),
};

async function render(pkg: string, cwd: string): Promise<string> {
  const { stdout } = await execa("python3", [RENDER_SCRIPT, pkg], { cwd });
  return stdout;
}

const hasPydocMarkdown = await execa("python3", ["-c", "import pydoc_markdown"])
  .then(() => true)
  .catch(() => false);

describe.skipIf(!hasPydocMarkdown)("pydoc_render.py", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pydoc-render-"));
    for (const [file, content] of Object.entries(files)) {
      await fs.outputFile(path.join(dir, file), content + "\n");
    }
  });

  afterAll(async () => {
    await fs.remove(dir);
  });

  it("documents members inherited from a base rendered on another page", async () => {
    const output = await render("pkg.impl", dir);

    expect(output).toContain("#### own");
    expect(output).toContain("#### inherited");
    expect(output).toContain("Defined on Base.");
    expect(output).toContain("Impl version.");
    expect(output).not.toContain("Base version.");
    expect(output).not.toContain("_private");
  });

  it("does not repeat members of a base rendered on the same page", async () => {
    const output = await render("pkg.page", dir);

    expect(output.match(/#### shared/g)).toHaveLength(1);
  });
});
