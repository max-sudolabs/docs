#!/usr/bin/env node
// Keeps the docs on the E2B colour and type systems. Fails on:
// - a literal colour (hex, rgb(…) with literal channels, a colour name) where a var(--color-*) role belongs;
// - a literal font size, line height, letter spacing or weight where an --e2b-* type token belongs;
// - a Mintlify --gray-* channel triplet that keeps a tint, breaks the ramp's order, or sits within 3 of a neutral step
//   without snapping to it (style.css: "steps within 3 of the colour system's neutral ramp snap to it");
// - a docs.json colour that differs from the role it stands for.
// It reads style.css, inline styles, <style> tags and Tailwind classes (named and arbitrary) in MDX and JSX, style writes in the
// root JS snippets, and docs.json. Comments, quoted strings and selectors are skipped, so hexes that name Mintlify
// classes ([class*="bg-[#2AB673]"]) or explain a mapping in prose are fine. A literal that has to stay carries
// "colour-check: allow" or "type-check: allow" in a comment on its line, with the reason.
// Usage: node scripts/check-styles.mjs   (from the repo root)

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const COLOUR = new RegExp(
    [
        String.raw`#[0-9a-f]{3,8}\b`,
        // Colour functions with literal channels; rgb(var(--x) / 1) and color-mix(… var(--x) …) build on a role.
        String.raw`\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!var\()`,
        // Named colours, but not inside a name (var(--background-white)).
        String.raw`(?<![\w-])(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|silver)(?![\w-])`,
    ].join("|"),
    "gi",
);
// Tailwind's named utilities in MDX and JSX classes, with or without Mintlify's mint- prefix: its palette (Mintlify's
// tinted grays, primary and brand included) and its type scale. Arbitrary values (text-[#fff], text-[13px]) are
// checked as CSS.
const TAILWIND_COLOUR = new RegExp(
    String.raw`^(?:mint-)?(?:text|bg|border(?:-[xytrbl])?|ring(?:-offset)?|outline|fill|stroke|decoration|divide|placeholder|caret|accent|shadow|from|via|to)-` +
        String.raw`(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|rose|pink|brand)-\d{2,3}|` +
        String.raw`primary(?:-light|-dark)?|white|black)(?:\/\d+)?$`,
);
const TAILWIND_TYPE =
    /^(?:mint-)?(?:text-(?:xs|sm|base|lg|[2-9]?xl)|leading-(?:none|tight|snug|normal|relaxed|loose|\d+)|tracking-(?:tighter|tight|normal|wide|wider|widest)|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black))$/;
const TYPE_PROPERTIES = new Set(["font", "font-size", "line-height", "letter-spacing", "font-weight"]);
// The type tokens themselves are where the literals live.
const TYPE_TOKEN = /^--e2b-(?:size|leading|tracking|weight|opsz)-/;
const TRIPLET = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/;
const ALLOW = { colour: /colour-check:\s*allow/, type: /type-check:\s*allow/ };

const problems = [];
const report = (file, line, message) => problems.push(`${file}:${line}: ${message}`);

// Blank out a match but keep its newlines, so offsets still map to line numbers.
const blank = (s) => s.replace(/[^\n]/g, " ");
const lineAt = (text, offset) => text.slice(0, offset).split("\n").length;

// The colour system: each theme's scale from its own block in color.css, the shared roles from the block that names
// both themes, and the hex build.py writes beside every scale step.
function readColourSystem() {
    const css = readFileSync("colors/color.css", "utf8");
    const scales = { dark: {}, light: {} };
    const roles = {};
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const dark = /\.dark\b/.test(selector);
        const light = /\.light\b/.test(selector);
        const target = dark && light ? roles : dark ? scales.dark : light ? scales.light : null;
        if (!target) continue;
        for (const [, name, value, hex] of body.matchAll(/(--[\w-]+):\s*([^;]+);(?:\s*\/\*\s*(#[0-9A-F]{6}))?/gi)) {
            target[name] = hex ? hex.toUpperCase() : value.trim();
        }
    }
    const resolve = (theme, name) => {
        for (let value = roles[name] ?? scales[theme][name], seen = 0; value && seen < 8; seen++) {
            if (value.startsWith("#")) return value;
            const ref = value.match(/^var\((--[\w-]+)\)$/);
            if (!ref) return null;
            value = roles[ref[1]] ?? scales[theme][ref[1]];
        }
        return null;
    };
    const neutrals = new Set(
        Object.values(scales).flatMap((scale) =>
            Object.entries(scale).filter(([name]) => /^--neutral-\d+$/.test(name)).map(([, hex]) => parseInt(hex.slice(1, 3), 16)),
        ),
    );
    return { resolve, neutrals };
}

const system = readColourSystem();

// Checks every declaration in CSS text. Embedded CSS (MDX style attributes, <style> tags) arrives as a copy of its
// file with everything else blanked, so offsets and line numbers still match the file.
function checkCss(file, css, source = css) {
    const lines = source.split("\n");
    const code = css
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, blank);
    const grays = [];
    const preludes = [];

    // A chunk followed by "{" opens a rule or at-rule; one followed by ";" or "}" is a declaration.
    for (const m of code.matchAll(/([^{};]*)([{};])/g)) {
        const [, text, end] = m;
        if (end === "{") {
            preludes.push(text.trim());
            continue;
        }
        const colon = text.indexOf(":");
        if (colon !== -1 && !preludes.some((p) => p.startsWith("@font-face"))) {
            const property = text.slice(0, colon).trim().toLowerCase();
            const value = text.slice(colon + 1).trim();
            const valueStart = m.index + colon + 1;
            const line = lineAt(code, valueStart + text.slice(colon + 1).search(/\S/));
            const allowed = (kind) => ALLOW[kind].test(lines[line - 1] ?? "");

            if (/^--gray-\d+$|^--default-border-color$/.test(property)) {
                checkGray(file, line, property, value, grays);
            } else if (!TYPE_TOKEN.test(property)) {
                if (!allowed("colour")) {
                    for (const hit of value.matchAll(COLOUR)) {
                        report(file, lineAt(code, valueStart + text.slice(colon + 1).indexOf(hit[0])),
                            `${property} uses a literal colour (${hit[0].trim()}…); use a var(--color-*) role`);
                    }
                    if (property.startsWith("--") && TRIPLET.test(value)) {
                        report(file, line, `${property} is a literal colour (${value}); use a var(--color-*) role`);
                    }
                }
                // Digits left once var(…) and !important are gone are a literal size, height, spacing or weight.
                let rest = value.replace(/!important/g, "");
                for (let before; before !== rest; ) [before, rest] = [rest, rest.replace(/var\([^()]*\)/g, "")];
                if (TYPE_PROPERTIES.has(property) && /\d/.test(rest) && !allowed("type")) {
                    report(file, line, `${property}: ${value} is a literal; use an --e2b-* type token`);
                }
            }
        }
        if (end === "}") preludes.pop();
    }
    checkGrayOrder(file, grays);
}

// Mintlify's gray scale with the tint removed: grey, and on a neutral step whenever it is within 3 of one.
function checkGray(file, line, property, value, grays) {
    const triplet = value.match(TRIPLET);
    if (!triplet) return report(file, line, `${property} should be an "r g b" triplet, got ${value}`);
    const [r, g, b] = triplet.slice(1).map(Number);
    if (r !== g || g !== b) return report(file, line, `${property} (${value}) is tinted; Mintlify's grays take r = g = b`);
    const near = [...system.neutrals].find((n) => n !== r && Math.abs(n - r) <= 3);
    if (near !== undefined) {
        const hex = near.toString(16).toUpperCase().padStart(2, "0").repeat(3);
        report(file, line, `${property} (${value}) is within 3 of neutral #${hex}; snap it to ${near} ${near} ${near}`);
    }
    const step = property.match(/^--gray-(\d+)$/);
    if (step) grays.push({ line, step: Number(step[1]), level: r });
}

function checkGrayOrder(file, grays) {
    grays.sort((a, b) => a.step - b.step);
    for (let i = 1; i < grays.length; i++) {
        if (grays[i].level >= grays[i - 1].level) {
            report(file, grays[i].line, `--gray-${grays[i].step} is not darker than --gray-${grays[i - 1].step}`);
        }
    }
}

// MDX and JSX: style attributes (JSX objects or strings), <style> tags and Tailwind classes. Code examples in fences
// and inline code are prose, not styles; a backtick string right after { is a JSX template literal, not code.
function checkMarkup(file) {
    const source = readFileSync(file, "utf8");
    const text = file.endsWith(".mdx")
        ? source.replace(/^(\s*)(`{3,}|~{3,})[\s\S]*?^\1\2\s*$/gm, blank).replace(/(?<!\{\s*)`[^`\n]*`/g, blank)
        : source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, blank);
    const css = [];
    const add = (offset, declarations) => css.push({ offset, declarations });

    for (const m of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
        // { fontSize: 14, color: "#fff" } → font-size: 14; color: #fff; with newlines kept
        const declarations = m[1]
            .replace(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g, " $2 ")
            .replace(/([a-z])([A-Z])/g, (_, a, b) => `${a}-${b.toLowerCase()}`)
            .replace(/,/g, ";");
        add(m.index + 8, `${declarations};`);
    }
    for (const m of text.matchAll(/style=(["'])(.*?)\1/g)) add(m.index + 7, `${m[2]};`);
    for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
        add(m.index + m[0].indexOf(">") + 1, m[1].replace(/^\s*\{\s*`|`\s*\}\s*$/g, (s) => blank(s)));
    }

    // One copy of the file per snippet, blanked outside it, so line numbers hold.
    for (const { offset, declarations } of css) {
        checkCss(file, blank(text.slice(0, offset)) + `.inline{${declarations}}`, source);
    }

    for (const m of text.matchAll(/class(?:Name)?=\{?\s*(["'`])(.*?)\1/g)) {
        const line = lineAt(text, m.index);
        const lineText = source.split("\n")[line - 1];
        for (const cls of m[2].split(/\s+/)) {
            const utility = cls.replace(/^(?:[\w-]+:)*!?/, "");
            const arbitrary = utility.match(/^([a-z-]+)-\[(.+)\]$/);
            const colour = arbitrary ? (COLOUR.lastIndex = 0, COLOUR.test(arbitrary[2])) : TAILWIND_COLOUR.test(utility);
            const type = arbitrary
                ? /^(?:text|leading|tracking|font)$/.test(arbitrary[1]) && /\d/.test(arbitrary[2])
                : TAILWIND_TYPE.test(utility);
            if (colour && !ALLOW.colour.test(lineText)) {
                report(file, line, `${cls} is a literal colour; use a var(--color-*) role`);
            } else if (type && !colour && !ALLOW.type.test(lineText)) {
                report(file, line, `${cls} is a literal; use an --e2b-* type token`);
            }
        }
    }
}

// Root JS snippets: element.style.x = "…", style.setProperty("x", "…"), style.cssText = "…".
function checkScript(file) {
    const source = readFileSync(file, "utf8");
    const text = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, blank);
    const writes = [
        ...[...text.matchAll(/\.style\.(\w+)\s*=\s*(["'`])(.*?)\2/g)].map((m) => [m.index, m[1], m[3]]),
        ...[...text.matchAll(/\.style\.setProperty\(\s*(["'`])(.*?)\1\s*,\s*(["'`])(.*?)\3/g)].map((m) => [m.index, m[2], m[4]]),
    ];
    for (const [offset, property, value] of writes) {
        const kebab = property === "cssText" ? null : property.replace(/([a-z])([A-Z])/g, (_, a, b) => `${a}-${b.toLowerCase()}`);
        checkCss(file, blank(text.slice(0, offset)) + `.inline{${kebab ? `${kebab}: ${value}` : value};}`, source);
    }
}

// docs.json can't name a role, so each colour must equal the role it stands for, in its theme. Mintlify's three
// accent colours may land in either theme.
function checkDocsJson() {
    const source = readFileSync("docs.json", "utf8");
    const docs = JSON.parse(source);
    const expected = {
        "colors.primary": [["dark", "light"], "--color-accent-solid"],
        "colors.light": [["dark", "light"], "--color-accent-solid"],
        "colors.dark": [["dark", "light"], "--color-accent-solid"],
        "background.color.light": [["light"], "--color-page"],
        "background.color.dark": [["dark"], "--color-page"],
    };
    const walk = (node, path) => {
        if (node && typeof node === "object") {
            for (const [key, child] of Object.entries(node)) walk(child, path ? `${path}.${key}` : key);
        } else if (typeof node === "string" && (COLOUR.lastIndex = 0, COLOUR.test(node)) && /^#|\(/.test(node)) {
            const line = lineAt(source, source.indexOf(`"${node}"`));
            const [themes, role] = expected[path] ?? [];
            const want = themes?.map((theme) => system.resolve(theme, role));
            if (!role) report("docs.json", line, `${path} is a literal colour with no role to check it against; add it to checkDocsJson`);
            else if (!want.includes(node.toUpperCase())) report("docs.json", line, `${path} is ${node}; ${role} is ${[...new Set(want)].join(" / ")}`);
        }
    };
    walk(docs, "");
}

const tracked = execFileSync("git", ["ls-files", "*.mdx", "*.jsx", "*.js"], { encoding: "utf8" }).split("\n").filter(Boolean);
checkCss("style.css", readFileSync("style.css", "utf8"));
for (const file of tracked) {
    if (/^(sdk-reference-generator|og-generator)\//.test(file)) continue;
    if (file.endsWith(".js")) checkScript(file);
    else checkMarkup(file);
}
checkDocsJson();

for (const problem of problems) console.log(problem);
if (problems.length) {
    console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}. Use a role from colors/color.css or an --e2b-* type`);
    console.log(`token from style.css. A literal that has to stay says why in a comment on its line that includes`);
    console.log(`"colour-check: allow" or "type-check: allow".`);
    process.exit(1);
}
