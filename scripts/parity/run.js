#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CpuRenderer, Surface, createDefaultRegistry, kernelFactories, compileDsl } from '../../src/index.js'
import { UPSTREAM_REVISION } from '../../src/effects/generated/upstream-snapshot.js'
import { readPng, writePng } from '../../src/node/png.js'
import { compareRgba8 } from './lib.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const NEW_CPU_EFFECT_IDS = new Set([
  'classicNoisedeck/noise3d', 'classicNoisedeck/shapes3d',
  'filter3d/flow3d', 'filter3d/palette3d',
  'render/loopBegin', 'render/loopEnd', 'render/render3d', 'render/renderCubemap3d',
  'render/renderCubemapSurface', 'render/renderLit3d',
  'synth3d/cell3d', 'synth3d/cellularAutomata3d', 'synth3d/flythrough3d',
  'synth3d/fractal3d', 'synth3d/noise3d', 'synth3d/reactionDiffusion3d', 'synth3d/shape3d',
])

function parseArgs(argv) {
  const options = { suite: 'all', size: 8, time: 0.25, seed: 1, tolerance: 2, writeCpu: false, json: false, only: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--suite') options.suite = argv[++index]
    else if (argument === '--size') options.size = Number(argv[++index])
    else if (argument === '--time') options.time = Number(argv[++index])
    else if (argument === '--seed') options.seed = Number(argv[++index])
    else if (argument === '--tolerance') options.tolerance = Number(argv[++index])
    else if (argument === '--only') options.only = argv[++index]
    else if (argument === '--write-cpu') options.writeCpu = true
    else if (argument === '--json') options.json = true
    else throw new TypeError(`Unknown parity option ${argument}`)
  }
  if (!['all', 'classic', 'defaults'].includes(options.suite)) throw new TypeError('--suite must be all, classic, or defaults')
  if (!Number.isInteger(options.size) || options.size <= 0) throw new TypeError('--size must be a positive integer')
  if (!Number.isFinite(options.time)) throw new TypeError('--time must be finite')
  if (!Number.isInteger(options.seed)) throw new TypeError('--seed must be an integer')
  if (!Number.isInteger(options.tolerance) || options.tolerance < 0) throw new TypeError('--tolerance must be a non-negative integer')
  return options
}

function fixtureSurface(width, height) {
  const surface = new Surface(width, height)
  surface.format = 'rgba16f'
  return surface
}

async function loadManifest() {
  const manifestPath = resolve(projectRoot, 'parity/upstream-defaults/manifest.tsv')
  const source = await readFile(manifestPath, 'utf8')
  return new Map(source.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, path] = line.split(/\s+/, 2)
    return [name, resolve(projectRoot, path)]
  }))
}

function suiteFor(definition) {
  return definition.namespace === 'classicNoisedeck' ? 'classic' : 'defaults'
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const registry = createDefaultRegistry()
  const manifest = await loadManifest()
  const candidates = registry.list().filter((definition) => {
    const suite = suiteFor(definition)
    if (options.suite !== 'all' && options.suite !== suite) return false
    if (options.only && options.only !== definition.id && options.only !== definition.id.replace('/', '__')) return false
    return true
  })
  // Keep the established 167-golden parity gate unchanged. The 21 pre-existing CPU-divergent
  // simulation effects and the 17 newly ported volume/loop effects are explicit, preflighted
  // skips until pinned GPU goldens exist for the latter set.
  const shouldSkip = (definition) => definition.iterated || NEW_CPU_EFFECT_IDS.has(definition.id)
  const definitions = candidates.filter((definition) => !shouldSkip(definition))
  const skipped = candidates.filter(shouldSkip)

  // A skip is an explicit claim that a healthy fixture exists with no GPU golden to compare
  // against - not a way to silently stop looking at these files. Read and compile each one
  // (parse the DSL and resolve every effect call against the registry) before it is ever reported
  // as SKIP, so a missing file, a parse error, or an unresolvable effect call fails this whole
  // command loudly instead of being indistinguishable from "intentionally excluded." This never
  // renders a pixel (`compileDsl` stops short of the pass-execution loop), so it doesn't
  // reintroduce the iterationCount:60-by-default cost of the iterated subset.
  for (const definition of skipped) {
    const name = definition.id.replace('/', '__')
    const programPath = manifest.get(name) ?? resolve(projectRoot, 'parity/upstream-defaults', `${name}.dsl`)
    let source
    try {
      source = await readFile(programPath, 'utf8')
    } catch (error) {
      throw new Error(`${definition.id} skip fixture is missing at ${programPath}: ${error.message}`)
    }
    try {
      compileDsl(source, registry, { sourceName: programPath })
    } catch (error) {
      throw new Error(`${definition.id} skip fixture ${programPath} failed to compile: ${error.message}`)
    }
  }

  const renderer = new CpuRenderer({ registry, kernelFactories })
  const blank = fixtureSurface(options.size, options.size)
  const results = []
  for (const definition of definitions) {
    const name = definition.id.replace('/', '__')
    const programPath = manifest.get(name) ?? resolve(projectRoot, 'parity/upstream-defaults', `${name}.dsl`)
    const source = await readFile(programPath, 'utf8')
    const rendered = renderer.render(source, {
      width: options.size,
      height: options.size,
      time: options.time,
      seed: options.seed,
      externalTextures: { imageTex: blank, textTex: blank },
      oneShot: 'initial',
    })
    const suite = suiteFor(definition)
    const directory = resolve(projectRoot, 'parity/goldens', suite)
    const golden = await readPng(resolve(directory, `${name}.golden.png`))
    if (golden.width !== options.size || golden.height !== options.size) {
      throw new Error(`${definition.id} golden is ${golden.width}x${golden.height}; requested ${options.size}x${options.size}`)
    }
    const actual = rendered.toRgba8()
    const comparison = compareRgba8(actual, golden.data, options.tolerance)
    results.push({ id: definition.id, ...comparison })
    if (options.writeCpu) await writePng(resolve(directory, `${name}.cpu.png`), rendered)
  }
  const failures = results.filter((result) => !result.pass).sort((left, right) => right.maxError - left.maxError || right.meanError - left.meanError)
  const summary = {
    sourceRevision: UPSTREAM_REVISION,
    suite: options.suite,
    size: options.size,
    time: options.time,
    seed: options.seed,
    tolerance: options.tolerance,
    effects: results.length,
    passed: results.length - failures.length,
    byteExact: results.filter((result) => result.exact).length,
    failures,
    skipped: skipped.map((definition) => definition.id),
  }
  if (options.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  else {
    process.stdout.write(`Parity ${summary.passed}/${summary.effects} within ±${summary.tolerance} RGBA bytes; ${summary.byteExact} byte-exact; ${summary.skipped.length} skipped\n`)
    for (const failure of failures) {
      process.stdout.write(`FAIL ${failure.id} max=${failure.maxError} mean=${failure.meanError.toFixed(4)} channels>${summary.tolerance}=${failure.channelsOverTolerance}\n`)
    }
    for (const id of summary.skipped) {
      const reason = NEW_CPU_EFFECT_IDS.has(id) ? 'newly ported, no GPU golden' : 'cpu-divergent, no GPU golden'
      process.stdout.write(`SKIP ${id} (${reason})\n`)
    }
  }
  if (failures.length > 0) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exitCode = 1
})
