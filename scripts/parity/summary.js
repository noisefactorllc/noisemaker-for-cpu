// GAP-003 whole-port parity summary. Counts every case of the current authority's
// manifest (the pinned upstream source's 210 effect IDs in
// src/effects/generated/upstream-snapshot.js `sourceEffectIds`, which includes the five
// explicitly excluded reactive/mesh effects as expected cases) against this port and the
// retained authority goldens. Classification is computed from real evidence only; it is
// never hand-assigned:
//   exact   — byte-identical RGBA output against the retained authority golden.
//   strict  — all channels within the gate's ±2-byte numerical contract (not byte-exact).
//   near    — reserved: mismatches beyond the contract that a separately authorized,
//             explicitly recorded per-case tolerance accepts. Nothing records one today.
//   defer   — reserved: explicitly recorded per-case deferrals with their own acceptance
//             record. Nothing records one today.
//   skip    — the explicit, fixture-preflighted skips (NEW_CPU_EFFECT_IDS / iterated)
//             with no captured authority golden to compare against.
//   fail    — rendered but exceeds the numerical contract (for example the accepted
//             GAP-001 CRT approximation).
//   missing — no implementation in this port (the five excluded effects) or an
//             unexplained hole (registry effect without a golden and without a skip
//             policy reason).
// The exit code reports whether the audit ran to completion, not a parity verdict: the
// PASS/FAIL verdict lives in the PARITY-SUMMARY JSON line, whose counts close GAP-003
// only when executed === expected, exact + strict === expected, and near, defer, skip,
// fail, and missing are all zero.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CpuRenderer, Surface, createDefaultRegistry, kernelFactories, compileDsl,
} from '../../src/index.js'
import { sourceEffectIds, UPSTREAM_REVISION } from '../../src/effects/generated/upstream-snapshot.js'
import { readPng } from '../../src/node/png.js'
import { compareRgba8, goldenReference, loadGoldenProvenance, NEW_CPU_EFFECT_IDS } from './lib.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const goldenRoot = resolve(projectRoot, 'parity', 'goldens')
const fixturesRoot = resolve(projectRoot, 'parity', 'upstream-defaults')

const SKIPPED_NO_GOLDEN = 'no captured authority golden (explicit skip policy: cpu-divergent or newly ported volume/loop effect)'
const MISSING_EXCLUDED = 'excluded from this port (upstream reactive/mesh effect; no CPU implementation)'

function fixtureSurface(width, height) {
  const surface = new Surface(width, height)
  surface.format = 'rgba16f'
  return surface
}

function suiteFor(id) {
  return id.startsWith('classicNoisedeck/') ? 'classic' : 'defaults'
}

function caseName(id) {
  return id.replace('/', '__')
}

function fixturePath(id) {
  return resolve(fixturesRoot, `${caseName(id)}.dsl`)
}

function goldenPath(id) {
  return resolve(goldenRoot, suiteFor(id), `${caseName(id)}.golden.png`)
}

// A case id is valid only if it is one of the authority manifest's effect IDs, in either
// documented spelling (`synth/media` or `synth__media`). Anything else is a typo and must
// fail loudly instead of quietly counting as zero.
export function selectCases(requested) {
  const authority = new Set(sourceEffectIds)
  const selected = []
  for (const id of requested) {
    const normalized = id.includes('__') ? id.replace('__', '/') : id
    if (!authority.has(normalized)) {
      throw new TypeError(`Unknown parity-summary case "${id}": not one of the ${authority.size} authority-manifest effect IDs`)
    }
    selected.push(normalized)
  }
  return [...new Set(selected)]
}

// Pure classification from gathered evidence; the CLI and the tests share it.
export function classifyCase({ id, inRegistry, hasGolden, skipPolicy }) {
  if (!inRegistry) {
    if (!sourceEffectIds.includes(id)) throw new TypeError(`classifyCase: ${id} is not an authority case`)
    return { id, verdict: 'missing', reason: MISSING_EXCLUDED }
  }
  if (!hasGolden) {
    if (skipPolicy) return { id, verdict: 'skip', reason: SKIPPED_NO_GOLDEN }
    return { id, verdict: 'missing', reason: 'registry effect with no authority golden and no explicit skip policy' }
  }
  return { id, verdict: 'render' }
}

export function buildSummary(rendered, skipped, missing, meta) {
  const exact = rendered.filter((result) => result.exact).length
  const strict = rendered.filter((result) => !result.exact && result.pass).length
  const fail = rendered.filter((result) => !result.pass).length
  return {
    sourceRevision: UPSTREAM_REVISION,
    size: meta.size,
    time: meta.time,
    seed: meta.seed,
    tolerance: meta.tolerance,
    expected: rendered.length + skipped.length + missing.length,
    executed: rendered.length,
    exact,
    strict,
    near: 0,
    defer: 0,
    skip: skipped.length,
    fail,
    missing: missing.length,
    // GAP-008: reference-image provenance reported separately from the candidate pin.
    referenceProvenance: {
      recorded: rendered.filter((result) => result.reference?.provenance === 'recorded').length,
      unknown: rendered.filter((result) => result.reference?.provenance !== 'recorded').length + skipped.length + missing.length,
    },
  }
}

function fixtureLine(id) {
  return `fixture=parity/upstream-defaults/${caseName(id)}.dsl golden=parity/goldens/${suiteFor(id)}/${caseName(id)}.golden.png`
}

async function preflightSkipFixture(registry, id) {
  // A skip is an explicit claim that a healthy fixture exists with no GPU golden to
  // compare against — read and compile it before reporting SKIP (the same discipline
  // as the parity gate in scripts/parity/run.js) so a missing file, a parse error, or
  // an unresolvable effect call fails loudly instead of hiding behind the skip label.
  // This never renders a pixel.
  let source
  try {
    source = await readFile(fixturePath(id), 'utf8')
  } catch (error) {
    throw new Error(`${id} skip fixture is missing at ${fixturePath(id)}: ${error.message}`)
  }
  try {
    compileDsl(source, registry, { sourceName: fixturePath(id) })
  } catch (error) {
    throw new Error(`${id} skip fixture ${fixturePath(id)} failed to compile: ${error.message}`)
  }
  return { source }
}

export async function runSummary(options = {}) {
  const meta = {
    size: options.size ?? 8,
    time: options.time ?? 0.25,
    seed: options.seed ?? 1,
    tolerance: options.tolerance ?? 2,
  }
  // The published numerical contract of this port is ±2; the summary classifies
  // `strict` against it and must not accept a widened tolerance as passes.
  if (meta.tolerance !== 2) {
    throw new TypeError('parity-summary enforces the published ±2 contract; --tolerance must be 2')
  }
  const selected = selectCases(options.requested ?? [])
  const registry = createDefaultRegistry()
  const definitions = new Map(registry.list().map((definition) => [definition.id, definition]))
  const provenance = await loadGoldenProvenance(goldenRoot)
  const cases = selected.length > 0 ? selected : sourceEffectIds

  const rendered = []
  const skipped = []
  const missing = []
  const renderer = new CpuRenderer({ registry, kernelFactories })
  const blank = fixtureSurface(meta.size, meta.size)
  for (const id of cases) {
    const definition = definitions.get(id)
    const classification = classifyCase({
      id,
      inRegistry: definition !== undefined,
      hasGolden: definition !== undefined && existsSync(goldenPath(id)),
      skipPolicy: definition !== undefined && (definition.iterated || NEW_CPU_EFFECT_IDS.has(id)),
    })
    if (classification.verdict === 'missing') {
      missing.push({ id, reason: classification.reason })
      continue
    }
    if (classification.verdict === 'skip') {
      await preflightSkipFixture(registry, id)
      skipped.push({ id, reason: classification.reason })
      continue
    }
    const source = await readFile(fixturePath(id), 'utf8')
    const renderedResult = renderer.render(source, {
      width: meta.size,
      height: meta.size,
      time: meta.time,
      seed: meta.seed,
      externalTextures: { imageTex: blank, textTex: blank },
      oneShot: 'initial',
    })
    const golden = await readPng(goldenPath(id))
    if (golden.width !== meta.size || golden.height !== meta.size) {
      throw new Error(`${id} golden is ${golden.width}x${golden.height}; requested ${meta.size}x${meta.size}`)
    }
    const comparison = compareRgba8(renderedResult.toRgba8(), golden.data, meta.tolerance)
    const reference = await goldenReference(goldenRoot, suiteFor(id), caseName(id), provenance)
    rendered.push({ id, ...comparison, reference })
  }

  const summary = buildSummary(rendered, skipped, missing, meta)
  const lines = []
  lines.push(`Reference provenance (GAP-008): ${summary.referenceProvenance.recorded} recorded, ${summary.referenceProvenance.unknown} unknown (sourceRevision ${summary.sourceRevision} is the candidate pin, not the reference capture revision)`)
  for (const result of rendered) {
    const reference = `reference=${result.reference.image} sha256=${result.reference.sha256} provenance=${result.reference.provenance}`
    lines.push(result.exact
      ? `EXACT ${result.id} (${fixtureLine(result.id)}; ${reference})`
      : `${result.pass ? 'STRICT' : 'FAIL'} ${result.id} max=${result.maxError} mean=${result.meanError.toFixed(4)} channels>${meta.tolerance}=${result.channelsOverTolerance} (${fixtureLine(result.id)}; ${reference})`)
  }
  for (const entry of skipped) lines.push(`SKIP ${entry.id} (${entry.reason})`)
  for (const entry of missing) lines.push(`MISSING ${entry.id} (${entry.reason})`)
  lines.push(`PARITY-SUMMARY ${JSON.stringify(summary)}`)
  return { summary, lines, cases, rendered, skipped, missing }
}