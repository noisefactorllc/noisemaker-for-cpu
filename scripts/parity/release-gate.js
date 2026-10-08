#!/usr/bin/env node

// Release gate over a complete `scripts/parity-summary` output. The export-kit
// workflow runs it after the summary and releases a kit only when it exits 0.
//
// The gate passes only when all of these are true:
//   - the output ends its run with one PARITY-SUMMARY line;
//   - every authority-manifest case is reported exactly once, and no other id is;
//   - no case is MISSING and the near and defer counts are zero;
//   - the SKIP cases are exactly the declared skip set (an undeclared skip fails,
//     and a declared skip that is no longer skipped fails until it is undeclared);
//   - the FAIL cases are exactly the accepted failures (filter/crt today, see
//     docs/CRT-PARITY.md);
//   - the PARITY-SUMMARY counts agree with the per-case lines.
//
// The declared skip set and the accepted failures are arguments, so the
// workflow file that runs the release states them.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { sourceEffectIds } from '../../src/effects/generated/upstream-snapshot.js'

const VERDICT = /^(EXACT|STRICT|FAIL|SKIP|MISSING|NEAR|DEFER) (\S+)/
const SUMMARY = /^PARITY-SUMMARY (.*)$/

function sorted(values) {
  return [...values].sort()
}

export function parseSummaryOutput(text) {
  const verdicts = new Map()
  const duplicates = []
  const summaries = []
  for (const line of text.split(/\r?\n/)) {
    const summaryMatch = SUMMARY.exec(line)
    if (summaryMatch) {
      summaries.push(summaryMatch[1])
      continue
    }
    const match = VERDICT.exec(line)
    if (!match) continue
    const [, verdict, id] = match
    if (verdicts.has(id)) duplicates.push(id)
    verdicts.set(id, verdict)
  }
  return { verdicts, duplicates, summaries }
}

export function evaluateReleaseGate(text, { declaredSkips, acceptedFailures, authority = sourceEffectIds }) {
  if (!Array.isArray(declaredSkips) || !Array.isArray(acceptedFailures)) {
    throw new TypeError('evaluateReleaseGate needs explicit declaredSkips and acceptedFailures arrays')
  }
  const errors = []
  const { verdicts, duplicates, summaries } = parseSummaryOutput(text)
  const authoritySet = new Set(authority)

  for (const id of [...declaredSkips, ...acceptedFailures]) {
    if (!authoritySet.has(id)) errors.push(`declared case ${id} is not an authority-manifest case`)
  }

  let summary = null
  if (summaries.length !== 1) {
    errors.push(`expected one PARITY-SUMMARY line, found ${summaries.length}`)
  } else {
    try {
      summary = JSON.parse(summaries[0])
    } catch (error) {
      errors.push(`PARITY-SUMMARY line is not JSON: ${error.message}`)
    }
  }

  for (const id of duplicates) errors.push(`${id} is reported more than once`)
  for (const id of verdicts.keys()) {
    if (!authoritySet.has(id)) errors.push(`${id} is reported but is not an authority-manifest case`)
  }
  const unreported = authority.filter((id) => !verdicts.has(id))
  if (unreported.length > 0) {
    errors.push(`${unreported.length} authority cases are not reported: ${unreported.join(', ')}`)
  }

  const byVerdict = (verdict) => sorted([...verdicts].filter(([, value]) => value === verdict).map(([id]) => id))
  const missing = byVerdict('MISSING')
  const skips = byVerdict('SKIP')
  const fails = byVerdict('FAIL')
  const near = byVerdict('NEAR')
  const defer = byVerdict('DEFER')

  for (const id of missing) errors.push(`MISSING ${id}: a release needs zero missing cases`)
  for (const id of near) errors.push(`NEAR ${id}: a release accepts no near cases`)
  for (const id of defer) errors.push(`DEFER ${id}: a release accepts no deferred cases`)

  const declaredSkipSet = new Set(declaredSkips)
  for (const id of skips) {
    if (!declaredSkipSet.has(id)) errors.push(`SKIP ${id} is not in the declared skip set`)
  }
  for (const id of declaredSkips) {
    if (verdicts.has(id) && verdicts.get(id) !== 'SKIP') {
      errors.push(`declared skip ${id} was reported ${verdicts.get(id)}; remove it from the declared skip set`)
    }
  }

  const acceptedFailureSet = new Set(acceptedFailures)
  for (const id of fails) {
    if (!acceptedFailureSet.has(id)) errors.push(`FAIL ${id} is not an accepted failure`)
  }
  for (const id of acceptedFailures) {
    if (verdicts.has(id) && verdicts.get(id) !== 'FAIL') {
      errors.push(`accepted failure ${id} was reported ${verdicts.get(id)}; remove it from the accepted failures`)
    }
  }

  if (summary) {
    const executed = byVerdict('EXACT').length + byVerdict('STRICT').length + fails.length
    const expectedCounts = {
      expected: authority.length,
      executed,
      exact: byVerdict('EXACT').length,
      strict: byVerdict('STRICT').length,
      near: 0,
      defer: 0,
      skip: skips.length,
      fail: fails.length,
      missing: 0,
    }
    for (const [key, value] of Object.entries(expectedCounts)) {
      if (summary[key] !== value) errors.push(`PARITY-SUMMARY ${key}=${summary[key]}, expected ${value}`)
    }
    if (summary.tolerance !== 2) errors.push(`PARITY-SUMMARY tolerance=${summary.tolerance}, the contract is 2`)
    if (summary.expected !== summary.executed + summary.skip + summary.missing) {
      errors.push('PARITY-SUMMARY expected does not equal executed + skip + missing')
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    counts: { reported: verdicts.size, missing: missing.length, skip: skips.length, fail: fails.length },
  }
}

function parseList(value, flag) {
  if (value === undefined) throw new TypeError(`${flag} needs a value (use '' for none)`)
  return value.split(/[\s,]+/).filter(Boolean)
}

export function parseArgs(argv) {
  let log = null
  let declaredSkips = null
  let acceptedFailures = null
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--declared-skips') declaredSkips = parseList(argv[++index], argument)
    else if (argument === '--accepted-failures') acceptedFailures = parseList(argv[++index], argument)
    else if (argument.startsWith('--')) throw new TypeError(`Unknown release-gate option ${argument}`)
    else if (log === null) log = argument
    else throw new TypeError(`Unexpected argument ${argument}`)
  }
  if (log === null) throw new TypeError('usage: release-gate.js <parity-summary log> --declared-skips <ids> --accepted-failures <ids>')
  if (declaredSkips === null) throw new TypeError('--declared-skips is required')
  if (acceptedFailures === null) throw new TypeError('--accepted-failures is required')
  return { log, declaredSkips, acceptedFailures }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { log, declaredSkips, acceptedFailures } = parseArgs(process.argv.slice(2))
    const result = evaluateReleaseGate(readFileSync(log, 'utf8'), { declaredSkips, acceptedFailures })
    const { reported, missing, skip, fail } = result.counts
    process.stdout.write(`release gate: ${reported} cases reported, missing ${missing}, skip ${skip} (declared ${declaredSkips.length}), fail ${fail} (accepted ${acceptedFailures.length})\n`)
    for (const error of result.errors) process.stdout.write(`::error::${error}\n`)
    process.stdout.write(result.ok ? 'release gate: PASS\n' : `release gate: FAIL (${result.errors.length} findings)\n`)
    process.exitCode = result.ok ? 0 : 1
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`)
    process.exitCode = 2
  }
}
