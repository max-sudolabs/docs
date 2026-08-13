#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getOgPages,
  HEIGHT,
  imagePathForRoute,
  imageUrlForRoute,
  listFilesWithinDirectory,
  loadRendererAssets,
  parsePage,
  renderOgImage,
  resolveWithinDirectory,
  STATIC_OG_IMAGES,
  upsertOgImage,
  upsertSdkReferenceImages,
  WIDTH,
} from './generator.js'

const generatorDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const rootDirectory = path.dirname(generatorDirectory)
const check = process.argv.includes('--check')

function isExpectedPng(image) {
  return (
    image.toString('ascii', 1, 4) === 'PNG' &&
    image.readUInt32BE(16) === WIDTH &&
    image.readUInt32BE(20) === HEIGHT
  )
}

async function main() {
  const config = JSON.parse(await readFile(path.join(rootDirectory, 'docs.json'), 'utf8'))
  const pages = getOgPages(config)
  const assets = await loadRendererAssets(rootDirectory)
  const expectedImages = new Set()
  const stale = []
  let generatedCount = 0
  const outputDirectory = await resolveWithinDirectory(
    rootDirectory,
    'images/og/generated',
  )

  if (!check) {
    await rm(outputDirectory, {
      force: true,
      recursive: true,
    })
  }

  for (const [route, section] of pages) {
    const pagePath = await resolveWithinDirectory(rootDirectory, `${route}.mdx`)
    const staticImageUrl = STATIC_OG_IMAGES.get(route)
    const imageUrl = staticImageUrl ?? imageUrlForRoute(route)
    const source = await readFile(pagePath, 'utf8')
    const { title } = parsePage(source, pagePath)
    const nextSource = upsertOgImage(source, imageUrl)

    if (staticImageUrl) {
      const staticImagePath = await resolveWithinDirectory(
        rootDirectory,
        staticImageUrl.slice(1),
      )
      if (check) {
        if (source !== nextSource) stale.push(path.relative(rootDirectory, pagePath))
        try {
          const staticImage = await readFile(staticImagePath)
          if (!isExpectedPng(staticImage)) {
            stale.push(path.relative(rootDirectory, staticImagePath))
          }
        } catch {
          stale.push(path.relative(rootDirectory, staticImagePath))
        }
      } else if (source !== nextSource) {
        await writeFile(pagePath, nextSource)
      }
      continue
    }

    const imagePath = await resolveWithinDirectory(
      rootDirectory,
      imagePathForRoute(route),
    )
    const image = await renderOgImage({ ...assets, section, title })
    expectedImages.add(imagePath)
    generatedCount += 1

    if (check) {
      if (source !== nextSource) stale.push(path.relative(rootDirectory, pagePath))
      try {
        const currentImage = await readFile(imagePath)
        if (!currentImage.equals(image)) stale.push(path.relative(rootDirectory, imagePath))
      } catch {
        stale.push(path.relative(rootDirectory, imagePath))
      }
      continue
    }

    await mkdir(path.dirname(imagePath), { recursive: true })
    await Promise.all([
      writeFile(pagePath, nextSource),
      writeFile(imagePath, image),
    ])
  }

  const sdkReferencePages = (
    await listFilesWithinDirectory(rootDirectory, 'sdk-reference')
  ).filter((file) => file.endsWith('.mdx'))

  for (const pagePath of sdkReferencePages) {
    const source = await readFile(pagePath, 'utf8')
    const nextSource = upsertSdkReferenceImages(source)
    if (source === nextSource) continue

    if (check) {
      stale.push(path.relative(rootDirectory, pagePath))
    } else {
      await writeFile(pagePath, nextSource)
    }
  }

  if (check) {
    try {
      const existingImages = await listFilesWithinDirectory(
        rootDirectory,
        'images/og/generated',
      )
      for (const imagePath of existingImages) {
        if (!expectedImages.has(imagePath)) {
          stale.push(path.relative(rootDirectory, imagePath))
        }
      }
    } catch {
      stale.push('images/og/generated')
    }

    if (stale.length > 0) {
      console.error('Generated OG images are stale. Run `pnpm generate` in og-generator:')
      for (const file of [...new Set(stale)].sort()) console.error(`- ${file}`)
      process.exitCode = 1
      return
    }
  }

  console.log(
    `${check ? 'Checked' : 'Generated'} ${generatedCount} route images, ${STATIC_OG_IMAGES.size} static default, and ${sdkReferencePages.length} SDK-reference pages.`,
  )
}

await main()
