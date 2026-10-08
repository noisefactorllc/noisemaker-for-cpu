import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const PINNED_UPSTREAM_REVISION = '5976b7a6b77f69c47c41f4ee296a54d5318e1f9d'
export const PINNED_SOURCE_PATHS = Object.freeze(['shaders/effects', 'shaders/src'])
export const PINNED_SOURCE_DIGEST = 'dfb565a24c33bd0e3dfaddc3f719d0f252b4c6f8df7059198a5f9e07b6a895d0'
// Digest over the committed pinned-source manifest (pinned-source-manifest.json):
// sha256 over each entry's path, '\0', size, '\0', per-file sha256 (sorted by path).
// This anchors the pin to a committed, machine-checkable record of the upstream
// tree's file identities instead of a self-attested pair of strings; the
// env-gated test cross-checks every entry against a real reference checkout.
export const PINNED_SOURCE_MANIFEST_PATH = 'pinned-source-manifest.json'
export const PINNED_SOURCE_MANIFEST_DIGEST = '9acfed79383c3254ca3ddd7a083f9beca7ea74ace23c1a080bb745e74e62494d'

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
