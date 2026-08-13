# Documentation Open Graph images

This package generates a 1200×630 social card for every public MDX page in
`docs.json`. The documentation root and SDK reference use shared static cards;
all other routes use the nearest navigation group as the section label and the
page frontmatter `title` as the main label.

```bash
pnpm install
pnpm generate
pnpm check
pnpm test
```

Generated PNGs are committed under `images/og/generated`. The generator adds
the corresponding quoted `og:image` property to each page's frontmatter and
normalizes both social-image properties across all SDK-reference snapshots.

## Design choices

- The section label uses PP Supply Sans Regular at 32px in Interface Orange
  `#e32a01`.
- The page title uses PP Supply Sans Light at 72px in Clarity White `#ffffff`,
  with the brand display treatment of 85% line height and −4% tracking.
- Both labels remain anchored 48px from the left and bottom edges.
- The licensed PP Supply Sans faces are committed only because this repository
  is private. Do not copy or redistribute them outside licensed E2B projects.
