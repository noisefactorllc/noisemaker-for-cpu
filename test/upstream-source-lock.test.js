import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import * as sourceLock from '../scripts/upstream/source-lock.js'

const FIXTURE_DIGEST = '45042a4208785921f2b9068fd3fb4d1d57334436540cd23deb2dc123330c353b'

test('upstream source lock hashes pinned paths deterministically without requiring a Git repository', async (t) => {
  // Break caught: reintroducing revision/status subprocess checks makes this non-repository
  // fixture fail even though its complete source content matches the expected digest.
  assert.equal(typeof sourceLock.computePinnedSourceDigest, 'function')

  const root = await mkdtemp(join(tmpdir(), 'noisemaker-source-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'shaders', 'effects'), { recursive: true })
  await mkdir(join(root, 'shaders', 'src'), { recursive: true })
  // Create in reverse lexical order: filesystem enumeration order must not affect the lock.
  await writeFile(join(root, 'shaders', 'src', 'b.js'), 'beta\n')
  await writeFile(join(root, 'shaders', 'effects', 'a.glsl'), 'alpha\n')

  assert.equal(sourceLock.computePinnedSourceDigest(root), FIXTURE_DIGEST)
  assert.equal(sourceLock.assertPinnedSource(root, FIXTURE_DIGEST), sourceLock.PINNED_UPSTREAM_REVISION)

  await writeFile(join(root, 'shaders', 'effects', 'a.glsl'), 'changed\n')
  assert.notEqual(sourceLock.computePinnedSourceDigest(root), FIXTURE_DIGEST)
  assert.throws(
    () => sourceLock.assertPinnedSource(root, FIXTURE_DIGEST),
    /source content digest mismatch/,
  )
})

test('PINNED_UPSTREAM_REVISION is a valid 40-character hexadecimal git commit SHA', () => {
  assert.match(sourceLock.PINNED_UPSTREAM_REVISION, /^[0-9a-f]{40}$/)
})

// Non-skipped anti-fabrication anchor: the pin constants must agree with the
// committed manifest of the pinned upstream tree. A hand-edited revision/
// digest pair that does not regenerate the manifest fails here with no
// upstream access at all.
test('committed pinned-source manifest anchors the pin constants', async () => {
  const manifestPath = new URL(`../scripts/upstream/${sourceLock.PINNED_SOURCE_MANIFEST_PATH}`, import.meta.url)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.revision, sourceLock.PINNED_UPSTREAM_REVISION)
  assert.deepEqual(manifest.paths, [...sourceLock.PINNED_SOURCE_PATHS])
  assert.ok(Array.isArray(manifest.entries) && manifest.entries.length > 0)
  // Entries must be sorted and individually well-formed.
  const sorted = [...manifest.entries].sort((left, right) => left.path.localeCompare(right.path))
  assert.deepEqual(manifest.entries, sorted)
  for (const entry of manifest.entries) {
    assert.match(entry.path, /^(shaders\/effects|shaders\/src)\//)
    assert.equal(typeof entry.size, 'number')
    assert.match(entry.sha256, /^[0-9a-f]{64}$/)
  }
  assert.equal(
    sourceLock.sourceManifestDigest(manifest.entries),
    sourceLock.PINNED_SOURCE_MANIFEST_DIGEST,
    'Committed pinned-source manifest does not digest to PINNED_SOURCE_MANIFEST_DIGEST; regenerate the pin artifacts from the pinned upstream revision.',
  )
})

// Automated anchor: when a real Noisemaker reference checkout is available
// (NM_REFERENCE_ROOT), every committed manifest entry must match the tree
// byte-for-byte and the tree must digest to PINNED_SOURCE_DIGEST. This is
// what makes the pin independently verifiable instead of self-attesting: a
// hand-edited pin bump fails here against any checkout of the named
// revision. Skipped (not failed) in environments without a reference
// checkout, so the suite stays checkout-free by default.
test('pinned source manifest matches the real upstream tree when NM_REFERENCE_ROOT is available', { skip: !process.env.NM_REFERENCE_ROOT }, async () => {
  const root = process.env.NM_REFERENCE_ROOT
  const manifestPath = new URL(`../scripts/upstream/${sourceLock.PINNED_SOURCE_MANIFEST_PATH}`, import.meta.url)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const computed = sourceLock.computeSourceManifest(root)
  assert.deepEqual(
    computed,
    manifest.entries,
    `Reference checkout at ${root} does not match the committed pinned-source manifest; the pin does not describe this upstream tree.`,
  )
  assert.equal(sourceLock.computePinnedSourceDigest(root), sourceLock.PINNED_SOURCE_DIGEST)
  assert.equal(sourceLock.sourceManifestDigest(computed), sourceLock.PINNED_SOURCE_MANIFEST_DIGEST)
})

// Checkout-free anti-staleness anchor: every compiled canonical kernel record
// carries the sha256 of the exact upstream GLSL bytes it was built from, and
// that hash must match the committed pinned-source manifest entry for the
// same file. If upstream GLSL changes and the kernels are not regenerated,
// these hashes stop matching the manifest and the suite fails here instead of
// silently shipping stale kernels — with no reference checkout required.
test('committed kernel records match the pinned-source manifest hashes', async () => {
  const manifestPath = new URL(`../scripts/upstream/${sourceLock.PINNED_SOURCE_MANIFEST_PATH}`, import.meta.url)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const manifestByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]))

  const coverageModule = await import('../src/effects/generated/glsl-coverage.js')
  assert.ok(Array.isArray(coverageModule.programCoverage) && coverageModule.programCoverage.length > 0)
  for (const record of coverageModule.programCoverage) {
    const sourcePath = `shaders/effects/${record.effectId}/glsl/${record.file}`
    const entry = manifestByPath.get(sourcePath)
    assert.ok(entry, `Coverage record file ${record.file} is not in the pinned-source manifest`)
    assert.match(record.sourceSha256, /^[0-9a-f]{64}$/, `Coverage record ${record.effectId}:${record.program} is missing its sourceSha256`)
    assert.equal(
      record.sourceSha256,
      entry.sha256,
      `Committed kernel ${record.effectId}:${record.program} was not built from the pinned bytes of ${sourcePath}; regenerate the canonical kernels.`,
    )
    assert.equal(record.sourceBytes, entry.size)
  }

  // Every pinned GLSL/fragment source that the port compiles must be
  // accounted for by a coverage record, so a manifest-only drift (effect
  // added/removed upstream) cannot hide an unported kernel change in either
  // direction. Excluded are the deliberately unported upstream trees
  // (mesh/reactive, mirrored from the generated snapshot's excludedEffects)
  // and shared include fragments under _shared/, which compile-glsl.js never
  // records as effect programs.
  const snapshot = await import('../src/effects/generated/upstream-snapshot.js')
  const excludedIds = new Set([...snapshot.excludedEffects.mesh, ...snapshot.excludedEffects.reactive])
  const eligible = new Set(snapshot.effectRecords.map((record) => record.id))
  const covered = new Set(coverageModule.programCoverage.map((record) => `shaders/effects/${record.effectId}/glsl/${record.file}`))
  for (const entry of manifest.entries) {
    if (!/\.(glsl|frag)$/.test(entry.path)) continue
    if (entry.path.includes('/_shared/')) continue
    const match = entry.path.match(/^shaders\/effects\/([^/]+\/[^/]+)\//)
    assert.ok(match, `Unexpected pinned source layout: ${entry.path}`)
    if (excludedIds.has(match[1])) continue
    assert.ok(eligible.has(match[1]), `Pinned source ${entry.path} belongs to an effect the snapshot does not carry`)
    assert.ok(covered.has(entry.path), `Pinned upstream source ${entry.path} has no committed kernel coverage record`)
  }
})
