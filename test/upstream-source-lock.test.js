import test from 'node:test'
import assert from 'node:assert/strict'

import { PINNED_UPSTREAM_REVISION, assertPinnedSource } from '../scripts/upstream/source-lock.js'

function gitStub({ head = PINNED_UPSTREAM_REVISION, dirty = '' } = {}) {
  return (_command, args) => args[0] === 'rev-parse' ? `${head}\n` : dirty
}

test('upstream generation source lock accepts only the exact clean pinned source', () => {
  assert.equal(assertPinnedSource('/reference', gitStub()), PINNED_UPSTREAM_REVISION)
  assert.throws(
    () => assertPinnedSource('/reference', gitStub({ head: '0000000000000000000000000000000000000000' })),
    /source revision mismatch/,
  )
  assert.throws(
    () => assertPinnedSource('/reference', gitStub({ dirty: ' M shaders\/effects\/synth\/noise\/glsl\/noise.glsl\n' })),
    /pinned source paths are dirty/,
  )
})
