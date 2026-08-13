import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  collectNavigationPages,
  getOgPages,
  HEIGHT,
  listFilesWithinDirectory,
  loadRendererAssets,
  renderOgImage,
  resolveWithinDirectory,
  SDK_REFERENCE_IMAGE_URL,
  STATIC_OG_IMAGES,
  upsertFrontmatterProperty,
  upsertOgImage,
  upsertSdkReferenceImages,
  validateRoute,
  WIDTH,
} from '../src/generator.js'

const generatorDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const rootDirectory = path.dirname(generatorDirectory)

test('collectNavigationPages uses the nearest navigation group', () => {
  const pages = collectNavigationPages(
    [
      'billing',
      {
        group: 'Quickstart',
        pages: ['quickstart', 'quickstart/connect-llms'],
      },
    ],
    'Getting started',
  )

  assert.deepEqual([...pages], [
    ['billing', 'Getting started'],
    ['quickstart', 'Quickstart'],
    ['quickstart/connect-llms', 'Quickstart'],
  ])
})

test('getOgPages reads tab navigation and skips SDK reference routes', () => {
  const pages = getOgPages({
    navigation: {
      tabs: [
        {
          tab: 'Sandboxes',
          groups: [
            {
              group: 'Getting started',
              root: 'getting-started',
              pages: [
                'quickstart',
                { group: 'Sandbox', pages: ['sandbox'] },
              ],
            },
          ],
        },
        { tab: 'Use cases', pages: ['use-cases/coding-agents'] },
        { tab: 'SDK Reference', pages: ['sdk-reference/example'] },
      ],
    },
  })

  assert.deepEqual([...pages], [
    ['getting-started', 'Getting started'],
    ['quickstart', 'Getting started'],
    ['sandbox', 'Sandbox'],
    ['use-cases/coding-agents', 'Use cases'],
  ])
})

test('documentation root uses the shared static image', () => {
  assert.equal(STATIC_OG_IMAGES.get('index'), '/images/og/opengraph-image.png')
})

test('validateRoute rejects traversal and absolute routes', () => {
  const unsafeRoutes = [
    '../outside',
    'guides/../../outside',
    '/tmp/outside',
    String.raw`C:\tmp\outside`,
  ]

  for (const route of unsafeRoutes) {
    assert.throws(() => validateRoute(route), /route/)
  }

  assert.equal(validateRoute('quickstart/connect-llms'), 'quickstart/connect-llms')
})

test('resolveWithinDirectory rejects paths outside the expected directory', async () => {
  await assert.rejects(
    resolveWithinDirectory(rootDirectory, '../outside.png'),
    /escapes its expected directory/,
  )
  assert.equal(
    await resolveWithinDirectory(rootDirectory, 'images/og/generated/example.png'),
    path.join(rootDirectory, 'images/og/generated/example.png'),
  )
})

test('resolveWithinDirectory rejects symlinks that escape the expected directory', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'e2b-og-generator-'))
  const root = path.join(temporaryDirectory, 'root')
  const outside = path.join(temporaryDirectory, 'outside')
  await Promise.all([mkdir(root), mkdir(outside)])
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }))

  const outsidePage = path.join(outside, 'page.mdx')
  await writeFile(outsidePage, '---\ntitle: Outside\n---\n')
  await symlink(outsidePage, path.join(root, 'page.mdx'))

  await assert.rejects(
    async () => resolveWithinDirectory(root, 'page.mdx'),
    /escapes its expected directory/,
  )

  await symlink(outside, path.join(root, 'generated'))
  await assert.rejects(
    async () => resolveWithinDirectory(root, 'generated/card.png'),
    /escapes its expected directory/,
  )
})

test('listFilesWithinDirectory rejects discovered symlinks that escape the root', async (t) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'e2b-og-generator-'))
  const root = path.join(temporaryDirectory, 'root')
  const sdkReference = path.join(root, 'sdk-reference')
  const outsidePage = path.join(temporaryDirectory, 'outside.mdx')
  await mkdir(sdkReference, { recursive: true })
  await writeFile(outsidePage, '---\ntitle: Outside\n---\n')
  await symlink(outsidePage, path.join(sdkReference, 'escape.mdx'))
  t.after(() => rm(temporaryDirectory, { force: true, recursive: true }))

  await assert.rejects(
    listFilesWithinDirectory(root, 'sdk-reference'),
    /escapes its expected directory/,
  )
})

test('upsertOgImage adds and updates quoted frontmatter', () => {
  const source = '---\ntitle: Example\n---\n\nContent\n'
  const added = upsertOgImage(source, '/images/og/generated/example.png')
  assert.match(added, /"og:image": "\/images\/og\/generated\/example\.png"/)

  const updated = upsertOgImage(added, '/images/og/generated/renamed.png')
  assert.match(updated, /"og:image": "\/images\/og\/generated\/renamed\.png"/)
  assert.equal(updated.match(/og:image/g)?.length, 1)
})

test('upsertOgImage preserves existing line endings and is idempotent', () => {
  const source = '---\r\ntitle: Example\r\nicon: book\r\n---\r\n\r\nContent\r\n'
  const imageUrl = '/images/og/generated/example.png'
  const updated = upsertOgImage(source, imageUrl)

  assert.equal(updated, upsertOgImage(updated, imageUrl))
  assert.match(updated, /icon: book\r\n"og:image"/)
  assert.match(updated, /example\.png"\n---\r\n/)
})

test('upsertFrontmatterProperty handles quoted property names', () => {
  const source = '---\ntitle: Example\n"twitter:image": "/old.png"\n---\n'
  const updated = upsertFrontmatterProperty(source, 'twitter:image', '/new.png')

  assert.match(updated, /"twitter:image": "\/new\.png"/)
  assert.equal(updated.match(/twitter:image/g)?.length, 1)
})

test('upsertSdkReferenceImages adds both shared image properties', () => {
  const source = '---\nsidebarTitle: "Sandbox"\n---\n'
  const updated = upsertSdkReferenceImages(source)

  assert.match(updated, new RegExp(`"og:image": "${SDK_REFERENCE_IMAGE_URL}"`))
  assert.match(updated, new RegExp(`"twitter:image": "${SDK_REFERENCE_IMAGE_URL}"`))
  assert.equal(updated, upsertSdkReferenceImages(updated))
})

test('renderOgImage produces a 1200 by 630 PNG', async () => {
  const assets = await loadRendererAssets(rootDirectory)
  const image = await renderOgImage({
    ...assets,
    section: 'Getting started',
    title: 'Billing & limits',
  })

  assert.equal(image.toString('ascii', 1, 4), 'PNG')
  assert.equal(image.readUInt32BE(16), WIDTH)
  assert.equal(image.readUInt32BE(20), HEIGHT)
})
