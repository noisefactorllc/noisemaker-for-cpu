import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CpuRenderer, Surface, createDefaultRegistry, kernelFactories } from '../src/index.js'
import { readPng } from '../src/node/png.js'
import { reviewedNearComparison, validateNearReview } from '../scripts/parity/near.js'
import { runSummary } from '../scripts/parity/summary.js'
import { sourceEffectIds, UPSTREAM_REVISION } from '../src/effects/generated/upstream-snapshot.js'
import { evaluateReleaseGate } from '../scripts/parity/release-gate.js'

const id = 'points/buddhabrot'
const meta = { size: 8, time: 0.25, seed: 1, tolerance: 2 }
const authorityRevision = 'c4f7cdd7656eb3e3ca8ced6624f19d6474607de8'
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

test('NEAR acceptance binds the current physical authority proof and rejects altered readbacks', async () => {
  const review = await compare()
  assert.equal(review.authorityCapture?.sourceRevision, authorityRevision)
  assert.equal(review.authorityCapture.independentRenderers, 2)
  assert.equal(review.authorityCapture.readsPerRenderer, 2)
  const manifest = JSON.parse(await readFile(new URL('../parity/goldens/provenance.json', import.meta.url), 'utf8'))
  assert.deepEqual(review.authorityCapture, manifest.goldens['defaults/points__buddhabrot.golden.png'].captureRecord.authorityValidation)
  const changed = structuredClone(review)
  changed.authorityCapture.readbacks[0].independentSha256 = '0'.repeat(64)
  assert.equal(validateNearReview(id, changed, { ...meta, sourceRevision: authorityRevision }), false)
})

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

test('reviewed NEAR accepts the fixture through a CRLF checkout and nothing else', async () => {
  const lf = fixture.replace(/\r\n/g, '\n')
  assert.equal((await compare({ source: lf })).accepted, true)
  assert.equal((await compare({ source: lf.replace(/\n/g, '\r\n') })).accepted, true)
  assert.equal(await compare({ source: lf.replace(/\n/g, '\r') }), null)
  assert.equal(await compare({ source: `${lf}\r\n` }), null)
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

test('reviewed NEAR evidence stays valid when the candidate pin moves past its recorded authority', async () => {
  const review = await compare()
  assert.ok(validateNearReview(id, review, { ...meta, sourceRevision: 'd0ed94ae19cca7328bc7d6b28902712a0838e1a9' }))
  const changed = structuredClone(review)
  changed.authorityCapture.sourceRevision = 'd0ed94ae19cca7328bc7d6b28902712a0838e1a9'
  assert.equal(validateNearReview(id, changed, { ...meta, sourceRevision: 'd0ed94ae19cca7328bc7d6b28902712a0838e1a9' }), false)
})

test('release gate accepts the reviewed NEAR evidence and rejects altered or absent evidence', async () => {
  const review = await compare()
  const navier = (await runSummary({ requested: ['synth/navierStokes'] })).rendered[0].near
  assert.equal(navier.accepted, true)
  const lines = sourceEffectIds.map((caseId) => {
    if (caseId === id) return `NEAR ${id} review=${JSON.stringify(review)}`
    if (caseId === 'synth/navierStokes') return `NEAR ${caseId} review=${JSON.stringify(navier)}`
    return `EXACT ${caseId}`
  })
  lines.push(`PARITY-SUMMARY ${JSON.stringify({
    sourceRevision: UPSTREAM_REVISION, ...meta,
    expected: 210, executed: 210, exact: 208, strict: 0, near: 2,
    defer: 0, skip: 0, fail: 0, missing: 0,
  })}`)
  const output = `${lines.join('\n')}\n`
  const policy = { declaredSkips: [], acceptedFailures: [] }
  assert.deepEqual(evaluateReleaseGate(output, policy).errors, [])
  assert.equal(evaluateReleaseGate(output.replace(`"sourceRevision":"${UPSTREAM_REVISION}"`, '"sourceRevision":"c4f7cdd7656eb3e3ca8ced6624f19d6474607de8"'), policy).ok, false)
  // A review bound to another authority than the pinned one never qualifies.
  assert.equal(evaluateReleaseGate(output.replace(`"authorityRevision":"${authorityRevision}"`, '"authorityRevision":"d0ed94ae19cca7328bc7d6b28902712a0838e1a9"'), policy).ok, false)
  assert.equal(evaluateReleaseGate(output.replace('"maxError":25', '"maxError":26'), policy).ok, false)
  assert.equal(evaluateReleaseGate(output.replace('"maxError":6', '"maxError":5'), policy).ok, false)
  assert.equal(evaluateReleaseGate(output.replace(/^NEAR points.*$/m, `NEAR ${id}`), policy).ok, false)
  assert.equal(evaluateReleaseGate(output.replace(/^NEAR synth.*$/m, 'NEAR synth/navierStokes'), policy).ok, false)
  assert.equal(evaluateReleaseGate(output.replace('"seed":1', '"seed":2'), policy).ok, false)
  // One case's review never qualifies another case.
  assert.equal(evaluateReleaseGate(output.replace(/^NEAR synth\/navierStokes review=.*$/m, `NEAR synth/navierStokes review=${JSON.stringify(review)}`), policy).ok, false)
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

test('navierStokes summary renders the reviewed candidate and reports one reviewed NEAR case', async () => {
  const result = await runSummary({ requested: ['synth/navierStokes'] })
  assert.deepEqual([
    result.summary.expected, result.summary.executed, result.summary.exact,
    result.summary.strict, result.summary.near, result.summary.skip, result.summary.fail,
  ], [1, 1, 0, 0, 1, 0, 0])
  const [rendered] = result.rendered
  assert.equal(rendered.pass, false)
  assert.equal(rendered.near.policy, '2026-10-17-m4-metal-webgl2-gap035-navierstokes')
  assert.equal(rendered.near.candidateSha256, 'ecf1c94478b607be4eecca8371ca201a213d53a8a9fdeb54a024360570dd52a4')
  assert.deepEqual(rendered.near.surfaces.map((surface) => [
    surface.surface, surface.maxError, surface.meanError, surface.differingChannels,
    surface.channelsOverTolerance, surface.differingPixels,
  ]), [['global_o1_write', 6, 0.55078125, 75, 18, 25]])
  assert.ok(validateNearReview('synth/navierStokes', rendered.near, { ...meta, sourceRevision: authorityRevision }))
  assert.equal(validateNearReview('points/buddhabrot', rendered.near, { ...meta, sourceRevision: authorityRevision }), false)
  assert.match(result.lines[1], /^NEAR synth\/navierStokes max=6 .*channels>2=18 .*review=/)
})

test('navierStokes NEAR rejects a changed candidate byte or another reference', async () => {
  const source = await readFile(new URL('../parity/upstream-defaults/synth__navierStokes.dsl', import.meta.url), 'utf8')
  const goldenUrl = new URL('../parity/goldens/defaults/synth__navierStokes.golden.png', import.meta.url)
  const navierGolden = await readPng(goldenUrl)
  const navierReference = {
    image: 'parity/goldens/defaults/synth__navierStokes.golden.png',
    sha256: createHash('sha256').update(await readFile(goldenUrl)).digest('hex'),
    captureRevision: '2026-10-17-m4-metal-webgl2-gap035-navierstokes',
    provenance: 'recorded',
  }
  const blank = new Surface(8, 8)
  blank.format = 'rgba16f'
  const actual = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories }).render(source, {
    width: 8, height: 8, time: 0.25, seed: 1, externalTextures: { imageTex: blank, textTex: blank }, oneShot: 'initial',
  }).toRgba8()
  const base = { id: 'synth/navierStokes', source, meta, reference: navierReference, authorityRevision }
  assert.equal((await reviewedNearComparison({ ...base, actual })).accepted, true)
  for (const index of [0, 28, 31]) {
    const changed = Uint8Array.from(actual)
    changed[index] += 1
    assert.equal(await reviewedNearComparison({ ...base, actual: changed }), null)
  }
  // The golden itself is not the reviewed candidate.
  assert.equal(await reviewedNearComparison({ ...base, actual: Uint8Array.from(navierGolden.data) }), null)
  assert.equal(await reviewedNearComparison({ ...base, actual, reference: { ...navierReference, provenance: 'unknown' } }), null)
  assert.equal(await reviewedNearComparison({ ...base, actual, source: `${source}\n` }), null)
  assert.equal(await reviewedNearComparison({ ...base, actual, meta: { ...meta, time: 0.5 } }), null)
})
