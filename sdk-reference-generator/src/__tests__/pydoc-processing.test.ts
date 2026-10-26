import { describe, it, expect } from "vitest";
import {
  closeUnterminatedFences,
  convertRawParamFields,
  processPydocMarkdown,
  removeTitleLines,
} from "../generators/pydoc.js";
import { cleanCliMarkdown } from "../generators/cli.js";

function fenceCount(text: string): number {
  return text.split("\n").filter((line) => line.startsWith("```")).length;
}

describe("removeTitleLines", () => {
  it("drops module titles but keeps comments inside code examples", () => {
    const input = [
      "# e2b.sandbox_sync.main",
      "",
      "Example",
      "```python",
      "sandbox = Sandbox.create()",
      "# Returns True",
      "sandbox.is_running()",
      "```",
    ].join("\n");

    const output = removeTitleLines(input);

    expect(output).not.toContain("# e2b.sandbox_sync.main");
    expect(output).toContain("# Returns True");
  });
});

describe("closeUnterminatedFences", () => {
  it("closes an example fence before the next heading", () => {
    const input = [
      "@example",
      "```python",
      "same_sandbox = sandbox.connect()",
      "",
      "",
      "### connect",
      "",
      "```python",
      "def connect() -> Sandbox",
      "```",
    ].join("\n");

    const output = closeUnterminatedFences(input);

    expect(fenceCount(output)).toBe(4);
    expect(output).toContain("same_sandbox = sandbox.connect()\n```\n\n### connect");
  });

  it("closes a fence left open at the end of the file", () => {
    expect(fenceCount(closeUnterminatedFences("```python\nx = 1\n"))).toBe(2);
  });

  it("leaves balanced fences and headings-like comments alone", () => {
    const input = "```python\n# a comment\nx = 1\n```\n\n### next";
    expect(closeUnterminatedFences(input)).toBe(input);
  });
});

describe("convertRawParamFields", () => {
  it("turns a raw :param block into the Arguments list", () => {
    const input = [
      "Send data to command stdin.",
      "",
      ":param pid Process ID of the command.",
      ":param data: Data to send to the command",
      ":param request_timeout: Timeout for the request in **seconds**",
      "",
    ].join("\n");

    expect(convertRawParamFields(input)).toBe(
      [
        "Send data to command stdin.",
        "",
        "**Arguments**:",
        "",
        "- `pid`: Process ID of the command.",
        "- `data`: Data to send to the command",
        "- `request_timeout`: Timeout for the request in **seconds**",
        "",
      ].join("\n")
    );
  });

  it("leaves :param text inside code blocks alone", () => {
    const input = '```python\n""":param x: y"""\n```';
    expect(convertRawParamFields(input)).toBe(input);
  });
});

describe("processPydocMarkdown", () => {
  it("is idempotent on already processed pages", () => {
    const page = [
      "## Sandbox",
      "",
      "### is_running",
      "",
      "**Arguments**:",
      "",
      "- `request_timeout`: Timeout for the request in **seconds**",
      "",
      "Example",
      "```python",
      "sandbox.is_running() # Returns True",
      "```",
    ].join("\n");

    expect(processPydocMarkdown(page)).toBe(page);
  });
});

describe("cleanCliMarkdown", () => {
  it("drops stringified object defaults and keeps real ones", () => {
    const input = [
      " - `-e, --env <KEY=VALUE>: set environment variable (repeatable) [default: [object Object]]`",
      " - `-t, --template <template>: template to use [default: base]`",
    ].join("\n");

    expect(cleanCliMarkdown(input)).toBe(
      [
        " - `-e, --env <KEY=VALUE>: set environment variable (repeatable)`",
        " - `-t, --template <template>: template to use [default: base]`",
      ].join("\n")
    );
  });
});
