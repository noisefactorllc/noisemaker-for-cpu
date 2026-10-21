import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const wrapper = resolve('scripts/test-changed.mjs')

// The wrapper's selected run re-executes this very file; the depth guard keeps
// the recursion at exactly one level.
const GUARD = 'NM_WRAPPER_TEST_DEPTH'

function runWrapper(changedFiles) {
  // Strip NODE_TEST_CONTEXT so the spawned node --test actually executes files
  // instead of treating the launch as a nested runner run.
  const { NODE_TEST_CONTEXT, ...env } = process.env
  return spawnSync(process.execPath, [wrapper], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...env, NM_CHANGED_FILES: changedFiles, [GUARD]: '1' },
  })
}

test('wrapper runs only the referenced test file when NM_CHANGED_FILES is set', () => {
  if (process.env[GUARD]) return

  const result = runWrapper('test/test-changed-wrapper.test.js')

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /NM_CHANGED_FILES: running 1 test file\(s\)/)
  assert.match(result.stdout, /wrapper runs only the referenced test file when NM_CHANGED_FILES is set/)
  assert.match(result.stdout, /pass 2/)
  assert.match(result.stdout, /fail 0/)
  assert.doesNotMatch(result.stdout, /parity-near\.test\.js/)
})

test('wrapper runs nothing when no test file references the changed paths', () => {
  if (process.env[GUARD]) return

  // Assembled at runtime so this file's own source cannot match the wrapper's
  // source scan.
  const missing = ['scripts', 'definitely', 'no', 'tests', 'here'].join('/') + '.js'
  const result = runWrapper(missing)

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /no test file references the changed paths/)
  assert.doesNotMatch(result.stderr, /running \d+ test file/)
})
