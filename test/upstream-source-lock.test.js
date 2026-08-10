import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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
