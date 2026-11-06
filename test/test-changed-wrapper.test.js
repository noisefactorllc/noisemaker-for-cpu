import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const wrapper = resolve('scripts/test-changed.mjs')

// The wrapper's selected run re-executes this very file; the depth guard keeps
// the recursion at exactly one level.
const GUARD = 'NM_WRAPPER_TEST_DEPTH'

function runWrapper(changedFiles, shard = {}) {
  // Strip NODE_TEST_CONTEXT so the spawned node --test actually executes files
  // instead of treating the launch as a nested runner run, and strip the shard
  // variables so a sharded outer run does not shard the wrapper's own child.
  const { NODE_TEST_CONTEXT, NM_SHARD_COUNT, NM_SHARD_INDEX, ...env } = process.env
  return spawnSync(process.execPath, [wrapper], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: { ...env, NM_CHANGED_FILES: changedFiles, [GUARD]: '1', ...shard },
  })
}

test('wrapper runs only the referenced test file when NM_CHANGED_FILES is set', () => {
  if (process.env[GUARD]) return

  const result = runWrapper('test/test-changed-wrapper.test.js')

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /NM_CHANGED_FILES: running 1 test file\(s\)/)
  assert.match(result.stdout, /wrapper runs only the referenced test file when NM_CHANGED_FILES is set/)
  assert.match(result.stdout, /pass 3/)
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

test('wrapper runs only its shard of the changed-path selection', () => {
  if (process.env[GUARD]) return

  // Which shard holds a file follows the wrapper's own contract: the sorted
  // list of every *.test.* file under test/, taken modulo the shard count.
  // Recomputing that index here keeps this test independent of the tree order.
  const testFiles = []
  const walk = (relative) => {
    for (const entry of readdirSync(join('test', relative), { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(child)
      else if (/\.test\.[cm]?js$/.test(entry.name)) testFiles.push(`test/${child}`)
    }
  }
  walk('')
  testFiles.sort()
  const own = testFiles.indexOf('test/test-changed-wrapper.test.js')
  assert.ok(own >= 0, 'this file must be in the sorted test list')
  const held = own % 3
  const empty = (held + 1) % 3

  // A shard that does not hold the file reports the empty-selection message.
  const emptyRun = runWrapper('test/test-changed-wrapper.test.js', { NM_SHARD_COUNT: '3', NM_SHARD_INDEX: String(empty) })
  assert.equal(emptyRun.status, 0, emptyRun.stderr)
  assert.match(emptyRun.stderr, /no test file references the changed paths/)

  // The shard that holds the file runs it.
  const heldRun = runWrapper('test/test-changed-wrapper.test.js', { NM_SHARD_COUNT: '3', NM_SHARD_INDEX: String(held) })
  assert.equal(heldRun.status, 0, heldRun.stderr)
  assert.match(heldRun.stderr, new RegExp(`NM_CHANGED_FILES: running shard ${held}/3: 1 test file\\(s\\)`))
  assert.match(heldRun.stdout, /pass 3/)
  assert.match(heldRun.stdout, /fail 0/)
})
