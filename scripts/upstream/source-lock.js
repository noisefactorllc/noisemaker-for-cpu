import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const PINNED_UPSTREAM_REVISION = '1ee891a2665780356f8cdc45fe2f62aa511fcc7d'
export const PINNED_SOURCE_PATHS = Object.freeze(['shaders/effects', 'shaders/src'])
export const PINNED_SOURCE_DIGEST = '7d793c8ccd1f9f0b1ff4dfb9ddb8b1b47f53c75e76272929026d45bbe22a7a94'

function sourceFiles(path, files) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) sourceFiles(entryPath, files)
    else if (entry.isFile()) files.push(entryPath)
  }
}

export function computePinnedSourceDigest(referenceRoot) {
  const files = []
  for (const sourcePath of PINNED_SOURCE_PATHS) sourceFiles(join(referenceRoot, sourcePath), files)
  files.sort((left, right) => relative(referenceRoot, left).localeCompare(relative(referenceRoot, right)))

  const hash = createHash('sha256')
  for (const file of files) {
    const path = relative(referenceRoot, file).split('\\').join('/')
    const bytes = readFileSync(file)
    hash.update(path)
    hash.update('\0')
    hash.update(String(bytes.length))
    hash.update('\0')
    hash.update(bytes)
  }
  return hash.digest('hex')
}

export function assertPinnedSource(referenceRoot, expectedDigest = PINNED_SOURCE_DIGEST) {
  let digest
  try {
    digest = computePinnedSourceDigest(referenceRoot)
  } catch (error) {
    throw new Error(`Unable to hash Noisemaker source at ${referenceRoot}: ${error.message}`, { cause: error })
  }
  if (digest !== expectedDigest) {
    throw new Error(`Noisemaker source content digest mismatch: expected ${expectedDigest}, received ${digest}`)
  }
  return PINNED_UPSTREAM_REVISION
}
