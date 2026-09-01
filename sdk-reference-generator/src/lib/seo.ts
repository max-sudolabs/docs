import fs from "fs-extra";
import path from "path";
import { CONSTANTS } from "./constants.js";
import { log } from "./log.js";
import type { NavigationDropdown } from "../types.js";

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n/;
const NOINDEX_PATTERN = /^\s*noindex\s*:/;
const NOINDEX_LINE = "noindex: true";

export interface IndexingResult {
  indexable: number;
  noindexed: number;
  changed: number;
  missing: string[];
}

/**
 * Add or remove the `noindex: true` frontmatter key on one page's content.
 *
 * Mintlify reads `noindex` from page frontmatter and emits the matching robots
 * directive, so this key is the whole mechanism. Existing `noindex` lines are
 * dropped before the wanted state is written, which makes the transform
 * idempotent and lets a page become indexable again if it is ever promoted
 * back to the default version.
 *
 * Content without frontmatter is returned untouched. Every generated reference
 * page gets frontmatter from `flattenMarkdown`, and `verifyGeneratedDocs`
 * fails the run if one does not, so a page in that state is already broken and
 * this is not the place to paper over it.
 */
export function applyNoindexDirective(
  content: string,
  noindex: boolean
): string {
  const match = content.match(FRONTMATTER_PATTERN);

  if (!match) {
    return content;
  }

  const keys = match[1]
    .split("\n")
    .filter((line) => !NOINDEX_PATTERN.test(line));

  if (noindex) {
    keys.push(NOINDEX_LINE);
  }

  return `---\n${keys.join("\n")}\n---\n` + content.slice(match[0].length);
}

/**
 * Keep old SDK versions out of search results.
 *
 * Every versioned reference page is a real, indexable URL, so a release from
 * years ago competes with the current one for the same query - Google was
 * serving `sdk-reference/cli/v1.0.1/sandbox` for "e2b cli sandbox". Marking
 * every page of every non-default version `noindex` leaves the newest version
 * as the only one search engines rank, without hiding the older ones from the
 * version dropdown (Mintlify's `hidden` key would do that, which is why it is
 * the wrong tool here).
 *
 * This runs as a post-pass over the navigation on every sync rather than at
 * page-generation time, because generation is incremental: a page written
 * while its version was the newest is never rewritten once a later release
 * supersedes it, so the directive has to be re-derived from the current set of
 * versions each run.
 *
 * Note that Mintlify still lists these URLs in `sitemap.xml` - it excludes
 * `hidden` pages from the sitemap, not `noindex` ones. The robots directive is
 * what keeps them out of the index.
 */
export async function syncIndexingDirectives(
  navigation: NavigationDropdown[],
  docsDir: string
): Promise<IndexingResult> {
  const result: IndexingResult = {
    indexable: 0,
    noindexed: 0,
    changed: 0,
    missing: [],
  };

  for (const dropdown of navigation) {
    for (const version of dropdown.versions) {
      const noindex = !version.default;

      for (const page of version.pages) {
        const file = path.join(docsDir, `${page}${CONSTANTS.MDX_EXTENSION}`);

        if (!(await fs.pathExists(file))) {
          result.missing.push(page);
          continue;
        }

        const content = await fs.readFile(file, "utf-8");
        const updated = applyNoindexDirective(content, noindex);

        if (updated !== content) {
          await fs.writeFile(file, updated);
          result.changed++;
        }

        if (noindex) {
          result.noindexed++;
        } else {
          result.indexable++;
        }
      }
    }
  }

  log.info(
    `${result.indexable} indexable pages, ${result.noindexed} noindexed`,
    1
  );
  log.info(`Rewrote ${result.changed} files`, 1);

  if (result.missing.length > 0) {
    log.warn(`${result.missing.length} navigation pages have no MDX file`, 1);
    for (const page of result.missing.slice(0, 10)) {
      log.data(page, 2);
    }
  }

  return result;
}
