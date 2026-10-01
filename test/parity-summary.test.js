import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { accessSync, constants, readFileSync } from 'node:fs'
import test from 'node:test'

import { sourceEffectIds } from '../src/effects/generated/upstream-snapshot.js'
import { buildSummary, classifyCase, runSummary, selectCases } from '../scripts/parity/summary.js'

const ENTRYPOINT = 'scripts/parity-summary'

test('parity-summary entrypoint exists and is executable', () => {
  accessSync(ENTRYPOINT, constants.X_OK)
  const source = readFileSync(ENTRYPOINT, 'utf8')
  assert.match(source, /runSummary/)
})

test('authority manifest counts 210 expected cases including the five excluded effects', () => {
  assert.equal(sourceEffectIds.length, 210)
  for (const excluded of ['synth/roll', 'synth/scope', 'synth/spectrum', 'render/meshLoader', 'render/meshRender']) {
    assert.ok(sourceEffectIds.includes(excluded), `${excluded} must stay an expected case`)
  }
})

test('selectCases accepts both documented spellings and rejects unknown ids', () => {
  assert.deepEqual(selectCases(['filter/crt', 'filter__adjust']), ['filter/crt', 'filter/adjust'])
  assert.throws(() => selectCases(['notAnEffect']), /not one of the 210 authority-manifest effect IDs/)
  assert.throws(() => selectCases(['filter/bc']), /not one of the 210/)
})

test('classifyCase maps the excluded effects, skip policy, and unexplained holes', () => {
  assert.deepEqual(
    classifyCase({ id: 'synth/roll', inRegistry: false, hasGolden: false, skipPolicy: false }),
    { id: 'synth/roll', verdict: 'missing', reason: 'excluded from this port (upstream reactive/mesh effect; no CPU implementation)' },
  )
  assert.equal(
    classifyCase({ id: 'render/renderLandscape3d', inRegistry: true, hasGolden: false, skipPolicy: true }).verdict,
    'skip',
  )
  assert.equal(
    classifyCase({ id: 'filter/crt', inRegistry: true, hasGolden: false, skipPolicy: false }).verdict,
    'missing',
  )
  assert.equal(
    classifyCase({ id: 'filter/crt', inRegistry: true, hasGolden: true, skipPolicy: false }).verdict,
    'render',
  )
  assert.throws(() => classifyCase({ id: 'filter/bc', inRegistry: false, hasGolden: true, skipPolicy: false }), /not an authority case/)
})

test('buildSummary arithmetic satisfies the GAP-003 closure contract invariants', () => {
  const rendered = [
    { exact: true, pass: true },
    { exact: false, pass: true },
    { exact: false, pass: false },
  ]
  const summary = buildSummary(rendered, [{ id: 'a' }], [{ id: 'b' }], { size: 8, time: 0.25, seed: 1, tolerance: 2 })
  assert.equal(summary.expected, 5)
  assert.equal(summary.executed, summary.exact + summary.strict + summary.fail)
  assert.equal(summary.expected, summary.executed + summary.skip + summary.missing)
  assert.deepEqual(
    ['near', 'defer'].map((key) => summary[key]),
    [0, 0],
  )
})

test('entrypoint run on one case emits a PARITY-SUMMARY last line', () => {
  const stdout = execFileSync(process.execPath, [ENTRYPOINT, 'filter/adjust'], { encoding: 'utf8' })
  const lastLine = stdout.trimEnd().split('\n').pop()
  assert.match(lastLine, /^PARITY-SUMMARY /)
  const summary = JSON.parse(lastLine.replace(/^PARITY-SUMMARY /, ''))
  assert.equal(summary.expected, 1)
  assert.equal(summary.executed, 1)
  assert.equal(summary.skip, 0)
  assert.equal(summary.missing, 0)
  assert.deepEqual([summary.near, summary.defer], [0, 0])
})

test('entrypoint run on an excluded case counts it as missing', () => {
  const stdout = execFileSync(process.execPath, [ENTRYPOINT, 'synth/roll'], { encoding: 'utf8' })
  const lastLine = stdout.trimEnd().split('\n').pop()
  const summary = JSON.parse(lastLine.replace(/^PARITY-SUMMARY /, ''))
  assert.equal(summary.expected, 1)
  assert.equal(summary.executed, 0)
  assert.equal(summary.missing, 1)
})

test('entrypoint run on one skipped case preflights the fixture and reports skip', () => {
  const stdout = execFileSync(process.execPath, [ENTRYPOINT, 'render/renderLandscape3d'], { encoding: 'utf8' })
  const lastLine = stdout.trimEnd().split('\n').pop()
  const summary = JSON.parse(lastLine.replace(/^PARITY-SUMMARY /, ''))
  assert.equal(summary.expected, 1)
  assert.equal(summary.skip, 1)
  assert.equal(summary.executed, 0)
})

test('entrypoint fails loudly on an unknown case id', () => {
  assert.throws(() => execFileSync(process.execPath, [ENTRYPOINT, 'filter/bc'], { encoding: 'utf8' }), /not one of the 210/)
})

test('runSummary rejects non-contract tolerance values', async () => {
  await assert.rejects(() => runSummary({ tolerance: 3 }), /enforces the published ±2 contract/)
})

test('entrypoint rejects a widened tolerance instead of counting passes', () => {
  assert.throws(() => execFileSync(process.execPath, [ENTRYPOINT, '--tolerance', '3', 'filter/adjust'], { encoding: 'utf8' }), /enforces the published ±2 contract/)
})

test('emitted comparisons carry reference provenance and the summary aggregates it', () => {
  const stdout = execFileSync(process.execPath, [ENTRYPOINT, 'filter/adjust'], { encoding: 'utf8' })
  const lines = stdout.trimEnd().split('\n')
  assert.match(lines[0], /^Reference provenance \(GAP-008\): 0 recorded, 1 unknown/)
  assert.match(lines[1], /reference=parity\/goldens\/defaults\/filter__adjust\.golden\.png sha256=[0-9a-f]{64} provenance=unknown/)
  const summary = JSON.parse(lines[lines.length - 1].replace(/^PARITY-SUMMARY /, ''))
  assert.deepEqual(summary.referenceProvenance, { recorded: 0, unknown: 1 })
})