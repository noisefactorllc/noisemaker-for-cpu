import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { readPng } from '../src/node/png.js'
import { reviewedNearComparison, validateNearReview } from '../scripts/parity/near.js'
import { runSummary } from '../scripts/parity/summary.js'
import { sourceEffectIds } from '../src/effects/generated/upstream-snapshot.js'
import { evaluateReleaseGate } from '../scripts/parity/release-gate.js'

const id = 'points/buddhabrot'
const meta = { size: 8, time: 0.25, seed: 1, tolerance: 2 }
const authorityRevision = '6cb1a3c3e21010db956d41e7a6d57a02b0be1e7d'
const fixture = await readFile(new URL('../parity/upstream-defaults/points__buddhabrot.dsl', import.meta.url), 'utf8')
const goldenPath = new URL('../parity/goldens/defaults/points__buddhabrot.golden.png', import.meta.url)
const golden = await readPng(goldenPath)
const reference = {
  image: 'parity/goldens/defaults/points__buddhabrot.golden.png',
  sha256: createHash('sha256').update(await readFile(goldenPath)).digest('hex'),
  captureRevision: '2026-10-16-m4-metal-webgl2-gap035-buddhabrot',
  provenance: 'recorded',
}

// Signed differences measured from the reviewed CPU frame and authority read surface.
const deltas = [
  [32, 6], [33, 6], [34, 7], [92, 7], [93, 7], [94, 7],
  [96, 10], [97, 9], [98, 10], [124, 7], [125, 8], [126, 8],
  [192, 6], [193, 6], [194, 6], [220, 12], [221, 12], [222, 12],
  [224, 6], [225, 6], [226, 6], [252, 5], [253, 5], [254, 5],
]
function candidate() {
  const bytes = Uint8Array.from(golden.data)
  for (const [index, difference] of deltas) bytes[index] += difference
  return bytes
}
const compare = (overrides = {}) => reviewedNearComparison({ id, actual: candidate(), source: fixture, meta, reference, authorityRevision, ...overrides })

test('reviewed buddhabrot NEAR reports both surface bounds without converting it to a strict pass', async () => {
  const review = await compare()
  assert.equal(review.accepted, true)
  assert.equal(review.candidateSha256, '6a61efff531cc10845fb436d51ae96ce97470c3f7c5c316be4e3151ff02f0f99')
  assert.deepEqual(review.surfaces.map((surface) => [
    surface.surface, surface.maxError, surface.meanError, surface.differingChannels,
    surface.channelsOverTolerance, surface.differingPixels,
  ]), [
    ['global_o0_read', 12, 0.69921875, 24, 24, 8],
    ['global_o0_write', 25, 0.86328125, 24, 24, 8],
  ])
  assert.ok(validateNearReview(id, review, { ...meta, sourceRevision: authorityRevision }))
})

test('reviewed NEAR rejects another fixture, authority, reference, or capture protocol', async () => {
  for (const overrides of [
    { source: `${fixture}\n` },
    { authorityRevision: 'different-authority' },
    { reference: { ...reference, sha256: '0'.repeat(64) } },
    { reference: { ...reference, provenance: 'unknown' } },
    { meta: { ...meta, time: 0.5 } },
    { meta: { ...meta, size: 16 } },
    { meta: { ...meta, seed: 2 } },
    { meta: { ...meta, tolerance: 3 } },
    { meta: { ...meta, oneShot: 'ready' } },
  ]) assert.equal(await compare(overrides), null)
})

test('reviewed NEAR rejects new pixels, larger differences, and alpha changes', async () => {
  for (const index of [0, 220, 35]) {
    const actual = candidate()
    actual[index] += 1
    assert.equal(await compare({ actual }), null)
  }
  assert.equal(await compare({ id: 'filter/crt' }), null)
  assert.equal(await compare({ id: 'synth/navierStokes' }), null)
})

test('NEAR evidence must retain both complete surface measurements and their bounds', async () => {
  const review = await compare()
  for (const mutate of [
    (value) => value.surfaces.pop(),
    (value) => { value.surfaces[1].maxError = 26 },
    (value) => { value.surfaces[0].pixels[0] = 9 },
    (value) => { value.protocol.frames = 59 },
    (value) => { value.candidateSha256 = '0'.repeat(64) },
  ]) {
    const changed = structuredClone(review)
    mutate(changed)
    assert.equal(validateNearReview(id, changed, { ...meta, sourceRevision: authorityRevision }), false)
  }
  assert.equal(validateNearReview(id, review, { ...meta, time: 0.5, sourceRevision: authorityRevision }), false)
})

test('release gate accepts the reviewed NEAR evidence and rejects altered or absent evidence', async () => {
  const review = await compare()
  const lines = sourceEffectIds.map((caseId) => {
    if (caseId === id) return `NEAR ${id} review=${JSON.stringify(review)}`
    if (caseId === 'synth/navierStokes') return `SKIP ${caseId}`
    if (caseId === 'filter/crt') return `FAIL ${caseId}`
    return `EXACT ${caseId}`
  })
  lines.push(`PARITY-SUMMARY ${JSON.stringify({
    sourceRevision: authorityRevision, ...meta,
    expected: 210, executed: 209, exact: 207, strict: 0, near: 1,
    defer: 0, skip: 1, fail: 1, missing: 0,
  })}`)
  const output = `${lines.join('\n')}\n`
  const policy = { declaredSkips: ['synth/navierStokes'], acceptedFailures: ['filter/crt'] }
  assert.deepEqual(evaluateReleaseGate(output, policy).errors, [])
  assert.equal(evaluateReleaseGate(output.replace('"maxError":25', '"maxError":26'), policy).ok, false)
  assert.equal(evaluateReleaseGate(output.replace(/^NEAR .*$/m, `NEAR ${id}`), policy).ok, false)
  assert.equal(evaluateReleaseGate(output.replace('"seed":1', '"seed":2'), policy).ok, false)
})

test('buddhabrot summary renders the unchanged candidate and reports one reviewed NEAR case', async () => {
  const result = await runSummary({ requested: [id] })
  assert.deepEqual([
    result.summary.expected, result.summary.executed, result.summary.exact,
    result.summary.strict, result.summary.near, result.summary.skip, result.summary.fail,
  ], [1, 1, 0, 0, 1, 0, 0])
  assert.equal(result.rendered[0].pass, false)
  assert.equal(result.rendered[0].near.candidateSha256, '6a61efff531cc10845fb436d51ae96ce97470c3f7c5c316be4e3151ff02f0f99')
  assert.match(result.lines[1], /^NEAR points\/buddhabrot max=12 .*channels>2=24 .*review=/)
})
