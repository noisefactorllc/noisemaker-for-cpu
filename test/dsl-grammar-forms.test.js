import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { Surface } from '../src/runtime/surface.js'
import { loadReferenceCompiler } from '../scripts/upstream/reference-compiler.js'

// GAP-047. Five grammar forms that the pinned authority documents in
// docs/shaders/language.rst: Math.PI, triple-quoted strings, a `let` alias of
// an effect function, the built-in volume I/O calls write3d(vol, geo) and
// read3d(vol, geo), and the namespace helper from(namespace, call()).

const cli = resolve('bin/noisemaker-cpu.js')
const SIZE = 8
const TIME = 0.25

function textTexture() {
  const surface = new Surface(SIZE, SIZE)
  for (let index = 0; index < surface.data.length; index += 4) {
    const pixel = index / 4
    surface.data.set([(pixel % SIZE) / SIZE, Math.floor(pixel / SIZE) / SIZE, 0.5, 1], index)
  }
  return surface
}

function renderBytes(source) {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  const result = renderer.render(source, { width: SIZE, height: SIZE, time: TIME, seed: 1, externalTextures: { textTex: textTexture() } })
  return Buffer.from(result.toRgba8())
}

function stepParams(source, id) {
  const plan = compileDsl(source, createDefaultRegistry())
  return plan.chains.flatMap((chain) => chain.steps).find((step) => step.definition?.id === id).params
}

// Each pair is [the authority form, its plain equivalent].
const PAIRS = {
  'Math.PI': [
    ['search synth\nnoise(seed: 1, scaleX: Math.PI * 4).write(o0)\nrender(o0)\n', 'search synth\nnoise(seed: 1, scaleX: 12.566370614359172).write(o0)\nrender(o0)\n'],
    ['search synth\nlet tau = Math.PI * 2\nnoise(seed: 1, scaleX: tau).write(o0)\nrender(o0)\n', 'search synth\nnoise(seed: 1, scaleX: 6.283185307179586).write(o0)\nrender(o0)\n'],
    ['search synth\nnoise(seed: 1, scaleX: (Math.PI + 1) / 2 - -Math.PI).write(o0)\nrender(o0)\n', `search synth\nnoise(seed: 1, scaleX: ${(Math.PI + 1) / 2 - -Math.PI}).write(o0)\nrender(o0)\n`],
  ],
  'triple-quoted strings': [
    ['search synth, filter\nsolid(color: #000).text(text: """hi""").write(o0)\nrender(o0)\n', 'search synth, filter\nsolid(color: #000).text(text: "hi").write(o0)\nrender(o0)\n'],
    ['search synth, filter\nsolid(color: #000).text(text: """Hello\nWorld""").write(o0)\nrender(o0)\n', 'search synth, filter\nsolid(color: #000).text(text: "Hello\\nWorld").write(o0)\nrender(o0)\n'],
  ],
  'let alias': [
    ['search synth\nlet pattern = noise\npattern(seed: 3).write(o0)\nrender(o0)\n', 'search synth\nnoise(seed: 3).write(o0)\nrender(o0)\n'],
    ['search synth\nlet pattern = noise\npattern(10).write(o0)\nrender(o0)\n', 'search synth\nnoise(10).write(o0)\nrender(o0)\n'],
    ['search synth\nlet tuned = noise(seed: 3)\nlet again = tuned\nagain(scaleX: 20).write(o0)\nrender(o0)\n', 'search synth\nnoise(seed: 3, scaleX: 20).write(o0)\nrender(o0)\n'],
    ['search synth, filter\nlet fx = invert\nnoise(seed: 1).fx().write(o0)\nrender(o0)\n', 'search synth, filter\nnoise(seed: 1).invert().write(o0)\nrender(o0)\n'],
  ],
  'write3d and read3d': [
    ['search synth3d, render\nnoise3d(seed: 1, volumeSize: 8).write3d(vol0, geo0)\nread3d(vol0, geo0).render3d().write(o0)\nrender(o0)\n', 'search synth3d, render\nnoise3d(seed: 1, volumeSize: 8).render3d().write(o0)\nrender(o0)\n'],
    ['search synth3d, render\nnoise3d(seed: 1, volumeSize: 8).write3d(vol1, geo1).render3d().write(o0)\nrender(o0)\n', 'search synth3d, render\nnoise3d(seed: 1, volumeSize: 8).render3d().write(o0)\nrender(o0)\n'],
    ['search synth3d, render\nnoise3d(seed: 1, volumeSize: 8).write3d(vol0, geo0)\nread3d(tex3d: vol0, geo: geo0).render3d().write(o0)\nrender(o0)\n', 'search synth3d, render\nnoise3d(seed: 1, volumeSize: 8).render3d().write(o0)\nrender(o0)\n'],
  ],
  from: [
    ['search synth, filter\nfrom(classicNoisedeck, noise(seed: 3)).write(o0)\nrender(o0)\n', 'search classicNoisedeck\nnoise(seed: 3).write(o0)\nrender(o0)\n'],
    ['search synth\nnoise(seed: 1).from(filter, invert()).write(o0)\nrender(o0)\n', 'search synth, filter\nnoise(seed: 1).invert().write(o0)\nrender(o0)\n'],
    ['search synth, mixer\nnoise(seed: 1).blendMode(tex: from(synth, solid(color: #ff0000)), mode: screen).write(o0)\nrender(o0)\n', 'search synth, mixer\nsolid(color: #ff0000).write(o1)\nnoise(seed: 1).blendMode(tex: read(o1), mode: screen).write(o0)\nrender(o0)\n'],
    ['search synth, filter\nlet n = from(classicNoisedeck, noise(seed: 3))\nn().write(o0)\nrender(o0)\n', 'search classicNoisedeck\nnoise(seed: 3).write(o0)\nrender(o0)\n'],
  ],
}

// A one-argument read3d(vol) names a volume (or geometry) for a parameter.
const READ3D_VALUE_FORM = [
  'search synth3d, render\ncellularAutomata3d(source: read3d(vol1), geoSource: read3d(geo1), volumeSize: x16).render3d().write(o0)\nrender(o0)\n',
  'search synth3d, render\ncellularAutomata3d(source: vol1, geoSource: geo1, volumeSize: x16).render3d().write(o0)\nrender(o0)\n',
]

// Each rejected program also fails on the pinned authority. The port reports
// each one with an existing message template. A from() call that the authority
// rejects stays a call named `from`, an unknown effect.
const REJECTED = [
  ['search synth\nnoise(seed: 1, scaleX: Math.E).write(o0)\nrender(o0)\n', /Parameter "scaleX" must be a finite number/],
  ['search synth\nnoise(seed: 1, scaleX: Math.PI()).write(o0)\nrender(o0)\n', /Expected "\)"/],
  ['search synth, filter\nsolid(color: #000).text(text: """open\n', /Unterminated string/],
  // Upstream's validator reports S003 for a bare identifier value that names
  // nothing resolvable at declaration (no earlier binding, no effect).
  ['search synth\nlet pattern = wobble\npattern().write(o0)\nrender(o0)\n', /Variable used before assignment: 'wobble'/],
  ['search synth\nlet pattern = noise\nnoise(seed: 1, scaleX: pattern).write(o0)\nrender(o0)\n', /Parameter "scaleX" must be a finite number/],
  ['search synth3d, render\nnoise3d(seed: 1, volumeSize: x16).write3d(vol0)\nrender(o0)\n', /Expected ","/],
  ['search synth3d, render\nnoise3d(seed: 1, volumeSize: x16).write3d(tex3d: vol0, geo: geo0)\nrender(o0)\n', /Expected ","/],
  ['search synth3d, render\nnoise3d(seed: 1, volumeSize: x16).write3d(5, geo0)\nrender(o0)\n', /Expected surface reference/],
  ['search synth3d, render\nnoise3d(seed: 1, volumeSize: x16).write3d(vol0, geo0)\nnoise3d(seed: 2).read3d(vol0, geo0).render3d().write(o0)\nrender(o0)\n', /Unknown effect "read3d" in search namespaces synth3d, render/],
  ['search synth3d, render\nwrite3d(vol0, geo0)\nrender(o0)\n', /Expected effect or IO function name/],
  ['search synth3d, render\nnoise3d(seed: 1, volumeSize: x16).write3d(vol0, geo0)\nread3d(vol0).render3d().write(o0)\nrender(o0)\n', /Unknown effect "read3d"/],
  ['search synth, filter\nfrom(ns: classicNoisedeck, call: noise(seed: 3)).write(o0)\nrender(o0)\n', /Unknown effect "from" in search namespaces synth, filter/],
  ['search synth, filter\nfrom(classicNoisedeck).write(o0)\nrender(o0)\n', /Unknown effect "from" in search namespaces synth, filter/],
  ['search synth, filter\nfrom("classicNoisedeck", noise(seed: 3)).write(o0)\nrender(o0)\n', /Unknown effect "from" in search namespaces synth, filter/],
  ['search synth, filter\nfrom(classicNoisedeck, noise).write(o0)\nrender(o0)\n', /Unknown effect "from" in search namespaces synth, filter/],
  ['search synth, filter\nfrom(classicNoisedeck, noise(seed: 3).invert()).write(o0)\nrender(o0)\n', /Unknown effect "from" in search namespaces synth, filter/],
  ['search synth, filter\nfrom(filter, noise(seed: 3)).write(o0)\nrender(o0)\n', /Unknown effect "noise" in search namespaces filter/],
]

for (const [form, pairs] of Object.entries(PAIRS)) {
  test(`${form}: each authority form renders the same RGBA bytes as its plain equivalent`, () => {
    for (const [authority, plain] of pairs) assert.deepEqual(renderBytes(authority), renderBytes(plain), authority)
  })
}

test('Math.PI evaluates to the same number as the authority parser folds', () => {
  assert.equal(stepParams(PAIRS['Math.PI'][0][0], 'synth/noise').scaleX, Math.PI * 4)
  assert.equal(stepParams(PAIRS['Math.PI'][2][0], 'synth/noise').scaleX, (Math.PI + 1) / 2 - -Math.PI)
})

test('write3d and read3d store and restore the volume and geometry surfaces, and read3d(vol) names a volume for a parameter', () => {
  const plan = compileDsl(PAIRS['write3d and read3d'][0][0], createDefaultRegistry())
  assert.deepEqual(plan.chains.map((chain) => chain.steps.map((step) => step.definition?.id ?? step.kind)), [
    ['synth3d/noise3d', 'write3d'],
    ['read3d', 'render/render3d', 'write'],
  ])
  assert.deepEqual([plan.chains[0].steps[1].volume, plan.chains[0].steps[1].geometry], ['vol0', 'geo0'])
  const named = (source) => stepParams(source, 'synth3d/cellularAutomata3d')
  const valueForm = named(READ3D_VALUE_FORM[0])
  const plain = named(READ3D_VALUE_FORM[1])
  assert.deepEqual([valueForm.source, valueForm.geoSource], ['vol1', 'geo1'])
  assert.deepEqual(valueForm, plain)
})

test('a triple-quoted string keeps its raw content, newlines and quotes included', () => {
  const text = (literal) => stepParams(`search synth, filter\nsolid(color: #000).text(text: ${literal}).write(o0)\nrender(o0)\n`, 'filter/text').text
  assert.equal(text('"""hi"""'), 'hi')
  assert.equal(text('"""Hello\nWorld"""'), 'Hello\nWorld')
  assert.equal(text('"""say "hi" now"""'), 'say "hi" now')
  assert.equal(text('""""""'), '')
  // Upstream's lexer keeps a triple-quoted string's content raw.
  assert.equal(text('"""a\\tb"""'), 'a\\tb')
  // A string whose content is punctuation is a string, in the first position too.
  assert.equal(stepParams('search synth, filter\nsolid(color: #000).text(")").write(o0)\nrender(o0)\n', 'filter/text').text, ')')
  assert.equal(stepParams('search synth, filter\nsolid(color: #000).text(""")""").write(o0)\nrender(o0)\n', 'filter/text').text, ')')
})

test('the CLI renders each of the five authority forms and exits 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-forms-'))
  try {
    const texture = join(dir, 'text.png')
    const { encodePng } = await import('../src/node/png.js')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(texture, encodePng({ width: SIZE, height: SIZE, data: textTexture().toRgba8() }))
    for (const [form, pairs] of Object.entries(PAIRS)) {
      const [authority, plain] = pairs[0]
      const args = ['render', '-', '--width', String(SIZE), '--height', String(SIZE), '--time', String(TIME), '--texture', `textTex=${texture}`, '--output']
      const first = spawnSync(process.execPath, [cli, ...args, join(dir, 'a.png')], { encoding: 'utf8', input: authority })
      const second = spawnSync(process.execPath, [cli, ...args, join(dir, 'b.png')], { encoding: 'utf8', input: plain })
      assert.equal(first.status, 0, `${form}: ${first.stderr}`)
      assert.equal(second.status, 0, `${form}: ${second.stderr}`)
      assert.deepEqual(await readFile(join(dir, 'a.png')), await readFile(join(dir, 'b.png')), form)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('forms that the authority rejects still fail', () => {
  const registry = createDefaultRegistry()
  for (const [source, error] of REJECTED) assert.throws(() => compileDsl(source, registry), error, source)
})

test('the pinned authority accepts and rejects the same programs and writes text that the port renders when NM_REFERENCE_ROOT is available', { skip: !process.env.NM_REFERENCE_ROOT }, async () => {
  const reference = await loadReferenceCompiler(process.env.NM_REFERENCE_ROOT)
  for (const pairs of Object.values(PAIRS)) {
    for (const [authority, plain] of pairs) {
      for (const source of [authority, plain]) {
        const outcome = reference.compile(source)
        assert.equal(outcome.accepted, true, `${source}: ${outcome.errors.join('; ')}`)
      }
    }
  }
  for (const source of READ3D_VALUE_FORM) assert.equal(reference.compile(source).accepted, true, source)
  // The authority unparser writes a multi-line string in triple quotes, and the
  // port reads it back.
  const written = reference.unparse(PAIRS['triple-quoted strings'][1][0])
  assert.match(written, /text: """Hello\nWorld"""/)
  assert.equal(stepParams(written, 'filter/text').text, 'Hello\nWorld')
  for (const [source] of REJECTED) assert.equal(reference.compile(source).accepted, false, source)
})
