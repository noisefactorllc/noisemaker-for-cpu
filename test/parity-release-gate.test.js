import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { sourceEffectIds } from '../src/effects/generated/upstream-snapshot.js'
import { evaluateReleaseGate, parseArgs } from '../scripts/parity/release-gate.js'

const DECLARED_SKIPS = [
  'filter3d/flow3d', 'points/buddhabrot', 'points/lenia',
  'synth/navierStokes', 'synth3d/cellularAutomata3d', 'synth3d/flythrough3d',
]
const ACCEPTED_FAILURES = ['filter/crt']
const POLICY = { declaredSkips: DECLARED_SKIPS, acceptedFailures: ACCEPTED_FAILURES }

// A summary output shaped like the real weekly run: every authority case
// graded, the six declared skips, and the accepted filter/crt failure.
function summaryOutput({ verdicts = {}, counts = {}, drop = [], extra = [] } = {}) {
  const lines = ['Reference provenance: 0 recorded, 210 unknown']
  const tally = { expected: 0, executed: 0, exact: 0, strict: 0, near: 0, defer: 0, skip: 0, fail: 0, missing: 0 }
  for (const id of sourceEffectIds) {
    if (drop.includes(id)) continue
    let verdict = verdicts[id]
    if (!verdict) verdict = DECLARED_SKIPS.includes(id) ? 'SKIP' : ACCEPTED_FAILURES.includes(id) ? 'FAIL' : 'EXACT'
    tally.expected += 1
    if (verdict === 'EXACT') { tally.exact += 1; tally.executed += 1 }
    if (verdict === 'STRICT') { tally.strict += 1; tally.executed += 1 }
    if (verdict === 'FAIL') { tally.fail += 1; tally.executed += 1 }
    if (verdict === 'SKIP') tally.skip += 1
    if (verdict === 'MISSING') tally.missing += 1
    lines.push(verdict === 'FAIL'
      ? `FAIL ${id} max=80 mean=5.0586 channels>2=89 (fixture=parity/upstream-defaults/x.dsl)`
      : `${verdict} ${id} (synthetic)`)
  }
  lines.push(...extra)
  const summary = { sourceRevision: 'synthetic', size: 8, time: 0.25, seed: 1, tolerance: 2, ...tally, ...counts }
  lines.push(`PARITY-SUMMARY ${JSON.stringify(summary)}`)
  return `${lines.join('\n')}\n`
}

test('the real-shaped summary (6 declared skips, filter/crt failing, 0 missing) passes', () => {
  const result = evaluateReleaseGate(summaryOutput(), POLICY)
  assert.deepEqual(result.errors, [])
  assert.equal(result.ok, true)
  assert.deepEqual(result.counts, { reported: 210, missing: 0, skip: 6, fail: 1 })
})

test('a MISSING case fails the gate even when its counts are consistent', () => {
  const result = evaluateReleaseGate(summaryOutput({ verdicts: { 'synth/roll': 'MISSING' } }), POLICY)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /^MISSING synth\/roll/.test(error)), result.errors.join('\n'))
  assert.ok(result.errors.some((error) => /missing=1, expected 0/.test(error)), result.errors.join('\n'))
})

test('an undeclared skip fails the gate', () => {
  const result = evaluateReleaseGate(summaryOutput({ verdicts: { 'filter/adjust': 'SKIP' } }), POLICY)
  assert.equal(result.ok, false)
  assert.ok(result.errors.includes('SKIP filter/adjust is not in the declared skip set'), result.errors.join('\n'))
})

test('a declared skip that is graded fails until the declaration drops it', () => {
  const result = evaluateReleaseGate(summaryOutput({ verdicts: { 'points/lenia': 'EXACT' } }), POLICY)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /^declared skip points\/lenia was reported EXACT/.test(error)), result.errors.join('\n'))
})

test('a failure other than the accepted filter/crt fails the gate', () => {
  const result = evaluateReleaseGate(summaryOutput({ verdicts: { 'filter/adjust': 'FAIL' } }), POLICY)
  assert.equal(result.ok, false)
  assert.ok(result.errors.includes('FAIL filter/adjust is not an accepted failure'), result.errors.join('\n'))
})

test('near and deferred cases fail the gate', () => {
  const result = evaluateReleaseGate(summaryOutput({ counts: { near: 1, defer: 1 } }), POLICY)
  assert.equal(result.ok, false)
  assert.ok(result.errors.includes('PARITY-SUMMARY near=1, expected 0'))
  assert.ok(result.errors.includes('PARITY-SUMMARY defer=1, expected 0'))
})

test('an unreported authority case fails the gate (no partial or filtered runs)', () => {
  const result = evaluateReleaseGate(summaryOutput({ drop: ['filter/adjust'] }), POLICY)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /1 authority cases are not reported: filter\/adjust/.test(error)), result.errors.join('\n'))
})

test('a duplicate or unknown case id fails the gate', () => {
  const result = evaluateReleaseGate(summaryOutput({ extra: ['EXACT filter/adjust (again)', 'EXACT filter/bogus (x)'] }), POLICY)
  assert.equal(result.ok, false)
  assert.ok(result.errors.includes('filter/adjust is reported more than once'))
  assert.ok(result.errors.includes('filter/bogus is reported but is not an authority-manifest case'))
})

test('a missing or repeated PARITY-SUMMARY line fails the gate', () => {
  const withoutSummary = summaryOutput().replace(/^PARITY-SUMMARY .*$/m, '')
  assert.ok(evaluateReleaseGate(withoutSummary, POLICY).errors.includes('expected one PARITY-SUMMARY line, found 0'))
  const output = summaryOutput()
  const repeated = output + output.split('\n').filter((line) => line.startsWith('PARITY-SUMMARY')).join('\n')
  assert.ok(evaluateReleaseGate(repeated, POLICY).errors.includes('expected one PARITY-SUMMARY line, found 2'))
})

test('summary counts that disagree with the case lines fail the gate', () => {
  const result = evaluateReleaseGate(summaryOutput({ counts: { skip: 5, expected: 209 } }), POLICY)
  assert.equal(result.ok, false)
  assert.ok(result.errors.includes('PARITY-SUMMARY skip=5, expected 6'))
  assert.ok(result.errors.includes('PARITY-SUMMARY expected=209, expected 210'))
})

test('the CLI requires explicit declarations', () => {
  assert.throws(() => parseArgs(['log.txt', '--accepted-failures', 'filter/crt']), /--declared-skips is required/)
  assert.throws(() => parseArgs(['log.txt', '--declared-skips', '']), /--accepted-failures is required/)
  assert.deepEqual(parseArgs(['log.txt', '--declared-skips', '', '--accepted-failures', 'filter/crt']), {
    log: 'log.txt', declaredSkips: [], acceptedFailures: ['filter/crt'],
  })
  assert.throws(() => evaluateReleaseGate(summaryOutput(), { declaredSkips: DECLARED_SKIPS }), /explicit declaredSkips and acceptedFailures/)
  const unknown = evaluateReleaseGate(summaryOutput(), { declaredSkips: [...DECLARED_SKIPS, 'filter/bogus'], acceptedFailures: ACCEPTED_FAILURES })
  assert.ok(unknown.errors.includes('declared case filter/bogus is not an authority-manifest case'))
})

// The parity job's own shell steps from .github/workflows/export-kit.yml, run in
// order after `npm ci` with the summary command replaced by the given output.
function parityJobSteps() {
  const lines = readFileSync('.github/workflows/export-kit.yml', 'utf8').split('\n')
  const start = lines.indexOf('  parity:')
  assert.notEqual(start, -1, 'export-kit.yml has a parity job')
  let end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line))
  if (end === -1) end = lines.length
  const steps = []
  for (let index = start; index < end; index += 1) {
    const match = /^(\s*)(?:- )?run: ?(.*)$/.exec(lines[index])
    if (!match) continue
    if (match[2].trim() !== '|') {
      steps.push(match[2].trim())
      continue
    }
    const indent = match[1].length + (lines[index].includes('- run:') ? 2 : 0)
    const body = []
    for (index += 1; index < end; index += 1) {
      const line = lines[index]
      if (line.trim() !== '' && line.search(/\S/) <= indent) { index -= 1; break }
      body.push(line.slice(indent + 2))
    }
    steps.push(body.join('\n'))
  }
  return steps.filter((step) => step !== 'npm ci')
}

function runParityJob(output) {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'cpu-release-gate-'))
  const fakeSummary = join(runnerTemp, 'summary-output.txt')
  writeFileSync(fakeSummary, output)
  for (const step of parityJobSteps()) {
    assert.doesNotMatch(step, /\.\/scripts\/parity-summary(?!\s*(?:2>&1|\||$))/m, 'the job runs the summary over every case')
    const script = step.replaceAll('./scripts/parity-summary', `cat ${JSON.stringify(fakeSummary)}`)
    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: runnerTemp },
    })
    if (result.status !== 0) return { status: result.status, output: result.stdout + result.stderr }
  }
  return { status: 0, output: '' }
}

test('the export-kit parity job passes the real-shaped summary', () => {
  const result = runParityJob(summaryOutput())
  assert.equal(result.status, 0, result.output)
})

test('the export-kit parity job refuses a release with a MISSING case', () => {
  const result = runParityJob(summaryOutput({ verdicts: { 'synth/roll': 'MISSING' } }))
  assert.notEqual(result.status, 0, 'a MISSING case must fail the release job')
})

test('the export-kit parity job refuses a release with an undeclared skip', () => {
  const result = runParityJob(summaryOutput({ verdicts: { 'filter/adjust': 'SKIP' } }))
  assert.notEqual(result.status, 0, 'an undeclared skip must fail the release job')
})
