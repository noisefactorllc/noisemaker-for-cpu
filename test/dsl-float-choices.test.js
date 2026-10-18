import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry, effectCatalog, kernelFactories, kernels } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { loadReferenceCompiler } from '../scripts/upstream/reference-compiler.js'

// GAP-038. A float parameter can declare inline choices. At the pinned
// authority the five `rotation` parameters below are type float with
// none: 0, fwd: 1 and back: -1. The authority validator resolves a bare
// identifier against inline choices, and its unparser writes the choice name.

const cli = resolve('bin/noisemaker-cpu.js')
const SIZE = 8
const TIME = 0.25
const SEED = 1

// Each program sets `rotation` on one of the five effects. `%` is replaced
// with the rotation value. The 2D base programs are the parity default
// fixtures. The volume program uses a small volume whose three rotations
// render three different frames.
const PROGRAMS = {
  'filter/palette': 'search filter, synth\nnoise(seed: 1, ridges: true).palette(rotation: %).write(o0)\nrender(o0)\n',
  'filter/historicPalette': 'search filter, synth\nnoise(seed: 1, ridges: true, colorMode: mono).historicPalette(rotation: %).write(o0)\nrender(o0)\n',
  'filter/tetraColorArray': 'search filter, synth\nnoise(seed: 1).tetraColorArray(smoothness: 0, rotation: %).write(o0)\nrender(o0)\n',
  'filter/tetraCosine': 'search filter, synth\nnoise(seed: 1).tetraCosine(rotation: %).write(o0)\nrender(o0)\n',
  'filter3d/palette3d': 'search synth3d, filter3d, render\nnoise3d(seed: 3, volumeSize: 8).palette3d(rotation: %).render3d().write(o0)\nrender(o0)\n',
}

function floatChoiceParams() {
  const found = []
  for (const definition of effectCatalog) {
    for (const [name, param] of Object.entries(definition.params)) {
      if (param.type === 'float' && param.choices) found.push({ id: definition.id, name, choices: param.choices })
    }
  }
  return found
}

function cases() {
  const out = []
  for (const { id, name, choices } of floatChoiceParams()) {
    for (const [choice, value] of Object.entries(choices)) {
      if (value === null) continue
      out.push({ id, name, choice, value, source: PROGRAMS[id].replace('%', choice), numeric: PROGRAMS[id].replace('%', String(value)) })
    }
  }
  return out
}

function renderer() {
  return new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
}

function renderBytes(source) {
  return Buffer.from(renderer().render(source, { width: SIZE, height: SIZE, time: TIME, seed: SEED }).toRgba8())
}

test('the catalog declares exactly the 15 float choice names of the five rotation parameters', () => {
  const params = floatChoiceParams()
  assert.deepEqual(params.map(({ id, name }) => `${id}.${name}`).sort(), Object.keys(PROGRAMS).map((id) => `${id}.rotation`).sort())
  assert.equal(cases().length, 15)
  for (const { choices } of params) assert.deepEqual(choices, { none: 0, fwd: 1, back: -1 })
})

test('every float choice name compiles to its numeric choice value', () => {
  const registry = createDefaultRegistry()
  for (const { id, name, choice, value, source } of cases()) {
    const plan = compileDsl(source, registry)
    const step = plan.chains[0].steps.find((entry) => entry.definition?.id === id)
    assert.equal(step.params[name], value, `${id} ${name}: ${choice}`)
  }
})

test('every float choice name renders the same RGBA bytes as its numeric value through the ESM API', () => {
  const frames = new Map()
  for (const { id, choice, source, numeric } of cases()) {
    const bytes = renderBytes(source)
    assert.deepEqual(bytes, renderBytes(numeric), `${id} rotation: ${choice}`)
    frames.set(`${id} ${choice}`, bytes.toString('hex'))
  }
  // The three choices of each effect render three different frames, so the
  // comparison above observes the resolved choice value.
  for (const id of Object.keys(PROGRAMS)) {
    const distinct = new Set(['none', 'fwd', 'back'].map((choice) => frames.get(`${id} ${choice}`)))
    assert.equal(distinct.size, 3, id)
  }
})

test('the CLI renders every float choice name to the same PNG as its numeric value', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-choices-'))
  try {
    for (const [index, { id, choice, source, numeric }] of cases().entries()) {
      const named = join(dir, `${index}-named.png`)
      const number = join(dir, `${index}-number.png`)
      const args = ['render', '-', '--width', String(SIZE), '--height', String(SIZE), '--time', String(TIME), '--seed', String(SEED), '--output']
      const first = spawnSync(process.execPath, [cli, ...args, named], { encoding: 'utf8', input: source })
      const second = spawnSync(process.execPath, [cli, ...args, number], { encoding: 'utf8', input: numeric })
      assert.equal(first.status, 0, `${id} rotation: ${choice}: ${first.stderr}`)
      assert.equal(second.status, 0, `${id} rotation: ${numeric}: ${second.stderr}`)
      assert.deepEqual(await readFile(named), await readFile(number), `${id} rotation: ${choice}`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a name that is not a float choice still fails with an error that names the parameter', () => {
  const registry = createDefaultRegistry()
  for (const id of Object.keys(PROGRAMS)) {
    assert.throws(() => compileDsl(PROGRAMS[id].replace('%', 'wobble'), registry), /Parameter "rotation"/, id)
  }
})

test('the pinned authority compiler accepts and rejects the same float choice programs when NM_REFERENCE_ROOT is available', { skip: !process.env.NM_REFERENCE_ROOT }, async () => {
  const reference = await loadReferenceCompiler(process.env.NM_REFERENCE_ROOT)
  for (const { id, choice, source, numeric } of cases()) {
    assert.equal(reference.compile(source).accepted, true, `${id} rotation: ${choice}`)
    assert.equal(reference.compile(numeric).accepted, true, `${id} numeric`)
  }
  for (const id of Object.keys(PROGRAMS)) {
    assert.equal(reference.compile(PROGRAMS[id].replace('%', 'wobble')).accepted, false, `${id} rotation: wobble`)
  }
})
