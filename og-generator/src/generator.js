import { readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

import { Resvg } from '@resvg/resvg-js'
import matter from 'gray-matter'
import satori from 'satori'

export const WIDTH = 1200
export const HEIGHT = 630
export const SDK_REFERENCE_IMAGE_URL = '/images/og/sdk-reference.png'
export const STATIC_OG_IMAGES = new Map([
  ['index', '/images/og/opengraph-image.png'],
  ['changelog', '/images/og/changelog.png'],
])
const INTERFACE_ORANGE = '#e32a01'

export function validateRoute(route) {
  if (typeof route !== 'string' || route.length === 0) {
    throw new Error('Documentation routes must be non-empty strings')
  }

  if (path.posix.isAbsolute(route) || path.win32.isAbsolute(route)) {
    throw new Error(`Documentation route must be relative: ${route}`)
  }

  const segments = route.split(/[\\/]/)
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Documentation route contains an unsafe path segment: ${route}`)
  }

  return route
}

function assertPathWithinDirectory(directory, resolved, relativePath) {
  const relative = path.relative(directory, resolved)

  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path escapes its expected directory: ${relativePath}`)
  }
}

export async function resolveWithinDirectory(directory, relativePath) {
  const root = path.resolve(directory)
  const resolved = path.resolve(root, relativePath)
  assertPathWithinDirectory(root, resolved, relativePath)

  const realRoot = await realpath(root)
  const missingSegments = []
  let existingPath = resolved

  while (true) {
    try {
      const realExistingPath = await realpath(existingPath)
      const realResolved = path.join(realExistingPath, ...missingSegments)
      assertPathWithinDirectory(realRoot, realResolved, relativePath)
      return realResolved
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error

      const parent = path.dirname(existingPath)
      if (parent === existingPath) throw error
      missingSegments.unshift(path.basename(existingPath))
      existingPath = parent
    }
  }
}

export async function listFilesWithinDirectory(rootDirectory, relativeDirectory) {
  const directory = await resolveWithinDirectory(rootDirectory, relativeDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relativeEntryPath = path.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) {
        return listFilesWithinDirectory(rootDirectory, relativeEntryPath)
      }

      return [await resolveWithinDirectory(rootDirectory, relativeEntryPath)]
    }),
  )

  return files.flat()
}

export function collectNavigationPages(items, inheritedSection, pages = new Map()) {
  for (const item of items ?? []) {
    if (typeof item === 'string') {
      pages.set(validateRoute(item), inheritedSection)
      continue
    }

    if (!item || typeof item !== 'object') continue

    if (typeof item.root === 'string') {
      pages.set(validateRoute(item.root), item.group ?? inheritedSection)
    }

    if (Array.isArray(item.pages)) {
      collectNavigationPages(item.pages, item.group ?? inheritedSection, pages)
    }
  }

  return pages
}

export function getOgPages(config) {
  const pages = new Map()
  const navigationItems = config.navigation?.tabs ?? config.navigation?.anchors ?? []

  for (const item of navigationItems) {
    const section = item.tab ?? item.anchor
    if (section === 'SDK Reference') continue

    collectNavigationPages(item.pages, section, pages)
    collectNavigationPages(item.groups, section, pages)
  }

  if (pages.size === 0) {
    throw new Error('Could not find any public pages in docs.json navigation')
  }

  return pages
}

export function parsePage(source, filePath) {
  const parsed = matter(source)
  if (typeof parsed.data.title !== 'string' || parsed.data.title.trim() === '') {
    throw new Error(`${filePath} is missing a title in its frontmatter`)
  }

  return { title: parsed.data.title.trim() }
}

export function upsertFrontmatterProperty(source, propertyName, value) {
  const match = source.match(/^(---(?:\r\n|\n))([\s\S]*?)(---)/)
  if (!match) throw new Error('Page is missing YAML frontmatter')

  const frontmatter = match[2]
  const escapedPropertyName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const property = new RegExp(
    `^[ \\t]*(?:["']${escapedPropertyName}["']|${escapedPropertyName})[ \\t]*:[^\\r\\n]*(?:\\r\\n|\\r|\\n)?`,
    'm',
  )
  const nextProperty = `"${propertyName}": "${value}"`
  const nextFrontmatter = property.test(frontmatter)
    ? frontmatter.replace(property, `${nextProperty}\n`)
    : `${frontmatter}${nextProperty}\n`

  return `${match[1]}${nextFrontmatter}${match[3]}${source.slice(match[0].length)}`
}

export function upsertOgImage(source, imageUrl) {
  return upsertFrontmatterProperty(source, 'og:image', imageUrl)
}

export function upsertSdkReferenceImages(source) {
  return upsertFrontmatterProperty(
    upsertFrontmatterProperty(source, 'og:image', SDK_REFERENCE_IMAGE_URL),
    'twitter:image',
    SDK_REFERENCE_IMAGE_URL,
  )
}

export async function loadRendererAssets(rootDirectory) {
  const [background, lightFont, regularFont] = await Promise.all([
    readFile(path.join(rootDirectory, 'og-generator/assets/og-bg.png')),
    readFile(path.join(rootDirectory, 'og-generator/assets/PPSupplySans-Light.ttf')),
    readFile(path.join(rootDirectory, 'og-generator/assets/PPSupplySans-Regular.ttf')),
  ])

  return {
    backgroundUrl: `data:image/png;base64,${background.toString('base64')}`,
    lightFont,
    regularFont,
  }
}

export async function renderOgImage({
  backgroundUrl,
  lightFont,
  regularFont,
  section,
  title,
}) {
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          backgroundColor: '#000000',
          color: '#ffffff',
          display: 'flex',
          fontFamily: 'PP Supply Sans',
          height: '100%',
          position: 'relative',
          width: '100%',
        },
        children: [
          {
            type: 'img',
            props: {
              alt: '',
              height: HEIGHT,
              src: backgroundUrl,
              style: {
                height: HEIGHT,
                left: 0,
                position: 'absolute',
                top: 0,
                width: WIDTH,
              },
              width: WIDTH,
            },
          },
          {
            type: 'div',
            props: {
              style: {
                bottom: 48,
                display: 'flex',
                flexDirection: 'column',
                left: 48,
                position: 'absolute',
                width: WIDTH - 96,
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      color: INTERFACE_ORANGE,
                      display: 'flex',
                      fontSize: 32,
                      fontWeight: 400,
                      lineHeight: 1,
                      textTransform: 'uppercase',
                    },
                    children: section,
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      color: '#ffffff',
                      display: 'flex',
                      fontSize: 72,
                      fontWeight: 300,
                      letterSpacing: '-0.04em',
                      lineHeight: 0.85,
                      marginTop: 16,
                      textTransform: 'uppercase',
                    },
                    children: title,
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      fonts: [
        {
          data: lightFont,
          name: 'PP Supply Sans',
          style: 'normal',
          weight: 300,
        },
        {
          data: regularFont,
          name: 'PP Supply Sans',
          style: 'normal',
          weight: 400,
        },
      ],
      height: HEIGHT,
      width: WIDTH,
    },
  )

  return new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
  })
    .render()
    .asPng()
}

export function imagePathForRoute(route) {
  return `images/og/generated/${route}.png`
}

export function imageUrlForRoute(route) {
  return `/${imagePathForRoute(route)}`
}
