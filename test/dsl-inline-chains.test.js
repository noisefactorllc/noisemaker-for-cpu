import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { loadReferenceCompiler } from '../scripts/upstream/reference-compiler.js'
import { PINNED_UPSTREAM_REVISION } from '../scripts/upstream/source-lock.js'

// GAP-046. The pinned authority grammar allows a chain as an argument value
// (`Expr ::= Chain | ...`). Upstream's validator compiles a chain in a surface
// argument into its own steps ahead of the consuming effect and binds the
// argument to that temporary surface. The port compiles the chain to a hidden
// surface that is written before the consuming effect runs.

const cli = resolve('bin/noisemaker-cpu.js')
const SIZE = 8
const TIME = 0.25
const fixture = JSON.parse(await readFile(new URL('./fixtures/authority-case-programs.json', import.meta.url), 'utf8'))
const manifest = JSON.parse(await readFile(new URL('../scripts/upstream/pinned-source-manifest.json', import.meta.url), 'utf8'))

// Each pair is [inline form, the same program with each chain written to an
// unused surface and read back].
const PAIRS = [
  // A one-call chain.
  [
    'search synth, mixer\nnoise(seed: 1).blendMode(tex: solid(color: #ff0000), mode: screen).write(o0)\nrender(o0)\n',
    'search synth, mixer\nsolid(color: #ff0000).write(o1)\nnoise(seed: 1).blendMode(tex: read(o1), mode: screen).write(o0)\nrender(o0)\n',
  ],
  // A multi-call chain.
  [
    'search synth, filter, mixer\nnoise(seed: 1).blendMode(tex: noise(seed: 2).invert(), mode: screen).write(o0)\nrender(o0)\n',
    'search synth, filter, mixer\nnoise(seed: 2).invert().write(o1)\nnoise(seed: 1).blendMode(tex: read(o1), mode: screen).write(o0)\nrender(o0)\n',
  ],
  // Two inline arguments in one call.
  [
    'search synth, mixer\nnoise(seed: 1).alphaMask(tex: solid(color: #ff0000), baseTex: solid(color: #0000ff, alpha: 0.25)).write(o0)\nrender(o0)\n',
    'search synth, mixer\nsolid(color: #ff0000).write(o1)\nsolid(color: #0000ff, alpha: 0.25).write(o2)\nnoise(seed: 1).alphaMask(tex: read(o1), baseTex: read(o2)).write(o0)\nrender(o0)\n',
  ],
  // Positional arguments.
  [
    'search synth, mixer\nnoise(seed: 1).blendMode(solid(color: #00ff00), screen).write(o0)\nrender(o0)\n',
    'search synth, mixer\nsolid(color: #00ff00).write(o1)\nnoise(seed: 1).blendMode(read(o1), screen).write(o0)\nrender(o0)\n',
  ],
  // A chain inside a chain argument.
  [
    'search synth, filter, mixer\nnoise(seed: 1).blendMode(tex: solid(color: #ff0000).blendMode(tex: noise(seed: 3), mode: multiply), mode: screen).write(o0)\nrender(o0)\n',
    'search synth, filter, mixer\nnoise(seed: 3).write(o2)\nsolid(color: #ff0000).blendMode(tex: read(o2), mode: multiply).write(o1)\nnoise(seed: 1).blendMode(tex: read(o1), mode: screen).write(o0)\nrender(o0)\n',
  ],
  // A partial binding called in a chain argument, and a partial that holds a
  // chain argument. A partial resolves its arguments where it is called.
  [
    'search synth, mixer\nlet red = solid(color: #ff0000)\nnoise(seed: 1).blendMode(tex: red(), mode: screen).write(o0)\nrender(o0)\n',
    'search synth, mixer\nsolid(color: #ff0000).write(o1)\nnoise(seed: 1).blendMode(tex: read(o1), mode: screen).write(o0)\nrender(o0)\n',
  ],
  [
    'search synth, mixer\nlet tint = blendMode(tex: solid(color: #ff0000), mode: screen)\nnoise(seed: 1).tint().write(o0)\nnoise(seed: 2).tint().write(o1)\nrender(o0)\n',
    'search synth, mixer\nsolid(color: #ff0000).write(o2)\nnoise(seed: 1).blendMode(tex: read(o2), mode: screen).write(o0)\nrender(o0)\n',
  ],
  // A partial that holds an automation value.
  [
    'search synth\nlet tuned = noise(seed: 1, scaleX: osc(type: oscKind.sine, min: 0.25, max: 0.75, speed: 0))\ntuned().write(o0)\nrender(o0)\n',
    'search synth\nnoise(seed: 1, scaleX: 25.75).write(o0)\nrender(o0)\n',
  ],
  // Chain arguments of a volume generator.
  [
    'search synth, filter, synth3d, render\nheightmap3d(heightTex: solid(color: #00ff00).invert(), tex: solid(color: #ff0000), volumeSize: x16).renderLandscape3d().write(o0)\nrender(o0)\n',
    'search synth, filter, synth3d, render\nsolid(color: #00ff00).invert().write(o1)\nsolid(color: #ff0000).write(o2)\nheightmap3d(heightTex: read(o1), tex: read(o2), volumeSize: x16).renderLandscape3d().write(o0)\nrender(o0)\n',
  ],
]

// The grammar also lets a chain argument start from read() or hold a subchain
// block. The pinned validator cannot compile these two forms: its substitute()
// reads `args` of every chain element, and a Read or Subchain node has none, so
// compile() throws a TypeError. The port compiles them by the grammar, so the
// differential test below leaves them out.
const GRAMMAR_PAIRS = [
  // A chain that starts from read(), after a mid-chain write in the same statement.
  [
    'search synth, filter, mixer\nnoise(seed: 1).write(o1).blendMode(tex: read(o1).invert(), mode: screen).write(o0)\nrender(o0)\n',
    'search synth, filter, mixer\nnoise(seed: 1).write(o1)\nread(o1).invert().write(o2)\nread(o1).blendMode(tex: read(o2), mode: screen).write(o0)\nrender(o0)\n',
  ],
  // A subchain block inside a chain argument.
  [
    'search synth, filter, mixer\nnoise(seed: 1).blendMode(tex: noise(seed: 2).subchain(name: "x") { .invert() }, mode: screen).write(o0)\nrender(o0)\n',
    'search synth, filter, mixer\nnoise(seed: 2).invert().write(o1)\nnoise(seed: 1).blendMode(tex: read(o1), mode: screen).write(o0)\nrender(o0)\n',
  ],
]

const REJECTED = [
  // write() is only allowed in statement context. The port reports it with the
  // existing message for a name that cannot be a chain element.
  ['search synth, mixer\nnoise(seed: 1).blendMode(tex: solid(color: #ff0000).write(o1), mode: screen).write(o0)\nrender(o0)\n', /Expected effect or IO function name/],
  // A chain argument must start with a generator or read().
  ['search filter, mixer, synth\nnoise(seed: 1).blendMode(tex: invert(), mode: screen).write(o0)\nrender(o0)\n', /filter\/invert requires an input/],
  // An effect that the search order does not resolve.
  ['search synth, mixer\nnoise(seed: 1).blendMode(tex: wobble(), mode: screen).write(o0)\nrender(o0)\n', /Unknown effect "wobble"/],
]

function renderBytes(source) {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  return Buffer.from(renderer.render(source, { width: SIZE, height: SIZE, time: TIME, seed: 1 }).toRgba8())
}

test('the committed authority case programs are the 144 parity-case.json files of the pinned manifest', () => {
  assert.equal(fixture.revision, PINNED_UPSTREAM_REVISION)
  const expected = manifest.entries.filter((entry) => entry.path.endsWith('/parity-case.json'))
  assert.equal(expected.length, 144)
  assert.deepEqual(fixture.cases.map(({ path }) => path), expected.map(({ path }) => path))
  for (const [index, { content }] of fixture.cases.entries()) {
    const bytes = Buffer.from(content, 'utf8')
    assert.equal(bytes.length, expected[index].size, expected[index].path)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected[index].sha256, expected[index].path)
  }
})

test('all 144 authority case programs compile with compileDsl', () => {
  const registry = createDefaultRegistry()
  const failures = []
  for (const { path, content } of fixture.cases) {
    try {
      compileDsl(JSON.parse(content).dsl, registry, { sourceName: path })
    } catch (error) {
      failures.push(`${path}: ${error.message}`)
    }
  }
  assert.deepEqual(failures, [])
})

test('the eight authority case programs with chain arguments render through the ESM API', () => {
  const inline = fixture.cases.filter(({ content }) => /(Tex|tex): (solid|testPattern)\(/.test(JSON.parse(content).dsl))
  assert.equal(inline.length, 8)
  for (const { path, content } of inline) {
    const result = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
      .render(JSON.parse(content).dsl, { width: SIZE, height: SIZE, time: TIME, seed: 1 })
    assert.equal(result.width, SIZE, path)
  }
})

test('a chain argument renders the same RGBA bytes as the chain written to an unused surface and read back', () => {
  for (const [inline, flat] of [...PAIRS, ...GRAMMAR_PAIRS]) assert.deepEqual(renderBytes(inline), renderBytes(flat), inline)
})

test('the async renderer renders a chain argument to the same bytes as the sync renderer', async () => {
  for (const [inline] of PAIRS.slice(0, 3)) {
    const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
    const result = await renderer.renderAsync(inline, { width: SIZE, height: SIZE, time: TIME, seed: 1, scheduler: async () => {} })
    assert.deepEqual(Buffer.from(result.toRgba8()), renderBytes(inline), inline)
  }
})

test('the CLI renders a chain argument program to the same PNG as the two-statement form', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-inline-'))
  try {
    const args = ['render', '-', '--width', String(SIZE), '--height', String(SIZE), '--time', String(TIME), '--output']
    for (const [index, [inline, flat]] of PAIRS.slice(0, 3).entries()) {
      const first = spawnSync(process.execPath, [cli, ...args, join(dir, `${index}-inline.png`)], { encoding: 'utf8', input: inline })
      const second = spawnSync(process.execPath, [cli, ...args, join(dir, `${index}-flat.png`)], { encoding: 'utf8', input: flat })
      assert.equal(first.status, 0, first.stderr)
      assert.equal(second.status, 0, second.stderr)
      assert.deepEqual(await readFile(join(dir, `${index}-inline.png`)), await readFile(join(dir, `${index}-flat.png`)), inline)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a chain argument that the authority rejects still fails', () => {
  const registry = createDefaultRegistry()
  for (const [source, error] of REJECTED) assert.throws(() => compileDsl(source, registry), error, source)
})

test('the pinned authority accepts the case programs and chain arguments and rejects the same failures when NM_REFERENCE_ROOT is available', { skip: !process.env.NM_REFERENCE_ROOT }, async () => {
  const root = process.env.NM_REFERENCE_ROOT
  const reference = await loadReferenceCompiler(root)
  for (const { path, content } of fixture.cases) {
    const live = join(root, path)
    assert.equal(existsSync(live), true, path)
    assert.equal(await readFile(live, 'utf8'), content, path)
    assert.equal(reference.compile(JSON.parse(content).dsl).accepted, true, path)
  }
  for (const pair of PAIRS) for (const source of pair) assert.equal(reference.compile(source).accepted, true, source)
  for (const [source] of REJECTED) assert.equal(reference.compile(source).accepted, false, source)
})
