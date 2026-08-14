# Documentation Open Graph images

This package generates a 1200×630 social card for every public MDX page in
`docs.json`. The documentation root, changelog, and SDK reference use static
cards; all other routes use the nearest navigation group as the section label
and the page frontmatter `title` as the main label.

```bash
pnpm install
pnpm generate
pnpm check
pnpm test
```

Generated PNGs are committed under `images/og/generated`. The generator adds
the corresponding quoted `og:image` property to each page's frontmatter and
normalizes both social-image properties across all SDK-reference snapshots.
The pull-request workflow runs generation automatically and commits any changes
back to same-repository PR branches. The local commands remain available for
previewing and verifying generator changes.

## Design choices

- The section label uses PP Supply Sans Semibold at 40px in Interface Orange
  `#e32a01`, with 100% line height and −1% tracking.
- The page title uses PP Supply Sans Light at 80px in Clarity White `#ffffff`,
  with 90% line height and −1% tracking.
- The labels are separated by 16px and anchored 78px from the left and bottom
  edges.
- The licensed PP Supply Sans faces are committed only because this repository
  is private. Do not copy or redistribute them outside licensed E2B projects.
