import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const PINNED_UPSTREAM_REVISION = '73c15be00d6888f4b5d2835d8e242ee9e840df45'
export const PINNED_SOURCE_PATHS = Object.freeze(['shaders/effects', 'shaders/src'])
export const PINNED_SOURCE_DIGEST = 'b78f27e21703a5ae3f976273e946f71b435193eeee4006c98caba229e3eedcaa'
// Digest over the committed pinned-source manifest (pinned-source-manifest.json):
// sha256 over each entry's path, '\0', size, '\0', per-file sha256 (sorted by path).
// This anchors the pin to a committed, machine-checkable record of the upstream
// tree's file identities instead of a self-attested pair of strings; the
// env-gated test cross-checks every entry against a real reference checkout.
export const PINNED_SOURCE_MANIFEST_PATH = 'pinned-source-manifest.json'
export const PINNED_SOURCE_MANIFEST_DIGEST = '1cb5f2447819f6b253ea70673e03bd3dbb04486272d111f844da44e4d3ff5edb'

function sourceFiles(path, files) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) sourceFiles(entryPath, files)
    else if (entry.isFile()) files.push(entryPath)
  }
}

// Same traversal and ordering as computePinnedSourceDigest, but records each
// file's identity (path, byte length, sha256) instead of hashing raw bytes, so
// the manifest can be committed, machine-checked anywhere, and cross-checked
// entry-by-entry against a reference checkout when one is available.
export function computeSourceManifest(referenceRoot) {
  const files = []
  for (const sourcePath of PINNED_SOURCE_PATHS) sourceFiles(join(referenceRoot, sourcePath), files)
  files.sort((left, right) => relative(referenceRoot, left).localeCompare(relative(referenceRoot, right)))
  return files.map((file) => {
    const bytes = readFileSync(file)
    return {
      path: relative(referenceRoot, file).split('\\').join('/'),
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  })
}

export function sourceManifestDigest(entries) {
  const hash = createHash('sha256')
  for (const entry of entries) {
    hash.update(entry.path)
    hash.update('\0')
    hash.update(String(entry.size))
    hash.update('\0')
    hash.update(entry.sha256)
  }
  return hash.digest('hex')
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
