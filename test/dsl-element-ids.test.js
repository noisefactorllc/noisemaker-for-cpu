import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { EffectDefinition } from '../src/effects/definition.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { loadReferenceCompiler } from '../scripts/upstream/reference-compiler.js'

const registry = createDefaultRegistry()
const header = 'search synth, synth3d, filter, mixer, render\n'
const compile = (body) => compileDsl(header + body, registry)

test('authored ids stay on effect, subchain body, inline and I/O steps without becoming uniforms', () => {
  const plan = compile(`let n = noise(_id: "base_2", seed: 1)
n().subchain(id: "block") { .invert(_id: 'flip') }.write(o1, _id: "w")
read(o1, _id: "r").blendMode(tex: n(_id: "over")).write(o0)
read(_id: "again", surface: o1).write(o2)
noise3d().write3d(vol0, geo0, _id: "w3")
read3d(vol0, geo0, _id: "r3").render3d().write(o3)
read3d(_id: "named3", tex3d: vol0, geo: geo0).render3d().write(o4)`)
  assert.deepEqual(plan.chains.map(({ steps }) => steps.map(step => step._id)), [
    ['base_2', 'flip', 'w'], ['r', undefined, undefined], ['again', undefined],
    [undefined, 'w3'], ['r3', undefined, undefined], ['named3', undefined, undefined],
  ])
  const inline = plan.chains[1].steps[1].inlineChains[0].chain.steps[0]
  assert.equal(inline._id, 'over')
  for (const step of [inline, ...plan.chains.flatMap(chain => chain.steps)]) {
    if (step.kind !== 'effect') continue
    assert.ok(!Object.hasOwn(step.params, '_id'))
    assert.ok(!step.explicitParams.includes('_id'))
  }
})

// On the 2.x line upstream refuses an id that is not an identifier string
// (S001) and a let carrying an id used twice without ids of its own (S011).
test('an invalid id and a let id used twice are refused, without resolving the id or warning', (t) => {
  const warnings = []
  t.mock.method(console, 'warn', message => warnings.push(message))
  for (const value of ['5', '""', '"9a"', '"a-b"', '"_a"', 'alias', 'unregistered()']) {
    assert.throws(() => compile(`let alias = "valid"\nlet n = noise(_id: "base")\nn(_id: ${value}).write(o0)`),
      /_id: takes a string literal of letters, digits and '_' that starts with a letter/, value)
  }
  assert.throws(() => compile('let n = noise(_id: "base_2")\nn().write(o1)\nn().write(o5)'), /_id: "base_2" is in a 'let' value used more than once/)
  assert.deepEqual(warnings, [])
})

test('ids on a saved pipeline leave its rendered bytes unchanged', () => {
  const renderer = new CpuRenderer({ registry, kernels, kernelFactories })
  const render = body => renderer.render(header + body, { width: 4, height: 4, seed: 1 }).toRgba8()
  const plain = 'noise(seed: 3).write(o1)\nread(o1).invert().write(o0)'
  const saved = 'noise(_id: "n", seed: 3).write(o1, _id: "w")\nread(_id: "r", tex: o1).invert(_id: "i").write(o0, _id: "w")'
  assert.deepEqual(render(saved), render(plain))
})

test('only the trailing id metadata may follow positional I/O targets', () => {
  for (const body of [
    'noise(1, _id: "n").write(o0)', 'noise(_id: "n", 1).write(o0)',
    'noise().write(o0,)', 'noise().write(surface: o0, _id: "x")', 'noise().write(o0, _id: "x",)',
    'noise().write(o0, other: "x")', 'noise().write(o0, _id: "x", other: "x")',
    'noise3d().write3d(vol0, geo0, other: "x")', 'read(o0, other: "x").write(o0)',
    'read3d(vol0, geo0, other: "x").render3d().write(o0)',
  ]) assert.throws(() => compile(body), { name: 'DslError' }, body)
})

// The catalog has no scalar r/g/b triple. A registered effect can declare one.
registry.register(new EffectDefinition({
  namespace: 'filter', func: 'rgbprobe', kind: 'filter',
  params: Object.fromEntries(['r', 'g', 'b', 'a', 'x'].map(name => [name, { type: 'float', default: 1 }])),
  passes: [{ kernel: 'filter/rgbprobe/main' }],
}))

test('a hex colour bound through let supplies r/g/b and preserves later positional indexes', () => {
  const r = 128 / 255, g = 64 / 255, b = 32 / 255
  for (const [binding, call, want] of [
    ['', 'rgbprobe(#804020)', [r, g, b, 1, 1]],
    ['let color = #804020', 'rgbprobe(color, 0.5, 0.6, 0.7)', [r, g, b, 0.7, 1]],
    ['let t = rgbprobe(#804020)', 't()', [r, g, b, 1, 1]],
    ['let t = rgbprobe(#804020)', 't(_skip: false)', [r, g, b, 1, 1]],
    ['let t = rgbprobe(#804020)', 't(g: 0.25)', [r, 0.25, b, 1, 1]],
    ['let t = rgbprobe(#804020)', 't(r: 0.25)', [0.25, g, b, 1, 1]],
    ['let t = rgbprobe(#804020, 0.5, 0.6, 0.7)', 't(_id: "t")', [r, g, b, 0.7, 1]],
    ['let t = rgbprobe(_id: "t")', 't(#804020)', [r, g, b, 1, 1]],
    ['let t = rgbprobe(r: 0.25)', 't(#804020, 0.5)', [0.25, 0.5, 1, 1, 1]],
    ['let t = rgbprobe(#804020)\nlet u = t(g: 0.25)', 'u(_id: "u")', [r, 0.25, b, 1, 1]],
    ['let t = rgbprobe(r: 0.25)\nlet u = t(#804020, 0.6)', 'u(_id: "u")', [0.25, 0.6, 1, 1, 1]],
  ]) {
    const step = compile(`${binding}\nnoise().${call}.write(o0)`).chains[0].steps[1]
    assert.deepEqual(Object.values(step.params), want, call)
  }
  assert.throws(() => compile('noise().rgbprobe([1, 0, 0]).write(o0)'), /finite number/)
})

test('an invalid chain argument reports its parameter at the first element, including through a partial', () => {
  for (const [prefix, expr, suffix] of [
    ['noise().blendMode(tex: ', 'read(o1).invert()', ').write(o0)'],
    ['noise().blendMode(', 'read(o1).invert()', ').write(o0)'],
    ['noise().blendMode(tex: ', 'noise().subchain("s") { .invert() }', ').write(o0)'],
    ['let mix = blendMode(tex: ', 'read(o1).invert()', ')\nnoise().mix().write(o0)'],
    ['noise().blendMode(tex: ', 'read3d(vol0, geo0).render3d()', ').write(o0)'],
  ]) {
    const body = 'noise().write(o1)\n' + prefix + expr + suffix
    assert.throws(() => compile(body), error => {
      assert.equal(error.name, 'DslError')
      assert.equal(error.code, 'S001')
      assert.match(error.message, /Chain for argument 'tex' in blendMode\(\) may contain only effect calls/)
      assert.equal(error.line, 3)
      assert.equal(error.column, prefix.length + 1)
      return true
    })
  }
})

test('read and read3d keep skip and id metadata and still read the named textures', () => {
  const render = body => new CpuRenderer({ registry, kernels, kernelFactories })
    .render(header + body, { width: 4, height: 4, time: 0.25, seed: 1 }).toRgba8()
  for (const [source, plain] of [
    ['solid(color: #f80).write(o1)\nread(surface: o1, _skip: true, _id: "r").write(o0)',
      'solid(color: #f80).write(o0)'],
    ['noise3d(seed: 2, volumeSize: x16).write3d(vol0, geo0)\nread3d(_id: "r", _skip: true, tex3d: vol0, geo: geo0).render3d().write(o0)',
      'noise3d(seed: 2, volumeSize: x16).render3d().write(o0)'],
  ]) {
    const read = compile(source).chains[1].steps[0]
    assert.equal(read._id, 'r')
    assert.equal(read._skip, true)
    const expected = render(plain)
    assert.ok(expected.some((byte, index) => index % 4 !== 3 && byte > 0))
    assert.deepEqual(render(source), expected)
  }
})

test('a bare read with id and skip metadata still supplies its surface argument', () => {
  const step = compile('noise().blendMode(tex: read(_id: "r", tex: o1, _skip: true)).write(o0)').chains[0].steps[1]
  assert.equal(step.params.tex.name, 'o1')
})

const RGB_REBINDINGS = [
  'let first = #f00\nlet color = first\nnoise().rgbprobe(color).write(o0)\nlet first = #0f0\nnoise().rgbprobe(color).write(o1)',
  'let color = #f00\nlet t = rgbprobe(color)\nlet color = #0f0\nnoise().t(_id: "x").write(o0)',
]

for (const [index, body] of RGB_REBINDINGS.entries()) {
  test(`a ${index === 0 ? 'value alias' : 'partial'} keeps the RGB colour at its declaration`, () => {
    for (const { steps } of compile(body).chains) {
      const { r, g, b } = steps[1].params
      assert.deepEqual([r, g, b], [1, 0, 0])
    }
  })
}

const nestedColor = expression => `let base = #f00
let t = blendMode(tex: ${expression})
let base = #0f0
noise().t(_id: "x").write(o0)`

test('a partial captures scalar RGB and color arguments inside its inline effect chain', () => {
  for (const expression of ['noise().rgbprobe(base)', 'solid(color: base)']) {
    const mix = compile(nestedColor(expression)).chains[0].steps[1]
    const { color, r, g, b } = mix.inlineChains[0].chain.steps.at(-1).params
    assert.deepEqual(color ?? [r, g, b], [1, 0, 0], expression)
  }
})

test('CPU and pinned upstream agree on declaration-time RGB values', { skip: !process.env.NM_REFERENCE_ROOT }, async () => {
  const reference = await loadReferenceCompiler(process.env.NM_REFERENCE_ROOT)
  const { registerOp } = await import(pathToFileURL(join(process.env.NM_REFERENCE_ROOT, 'shaders/src/lang/ops.js')).href)
  const probe = registry.get('filter', 'rgbprobe')
  registerOp('filter.rgbprobe', { name: 'rgbprobe', args: probe.paramNames.map(name => ({ name, ...probe.params[name] })) })
  for (const body of RGB_REBINDINGS) {
    const result = reference.compile(header + body)
    assert.deepEqual(result.errors, [])
    const upstream = result.result.plans.map(plan => plan.chain.find(step => step.op === 'filter.rgbprobe').args)
    const cpu = compile(body).chains.map(chain => chain.steps[1].params)
    const channels = ({ r, g, b }) => [r, g, b]
    assert.deepEqual(cpu.map(channels), upstream.map(channels))
  }
  for (const [expression, op] of [['noise().rgbprobe(base)', 'filter.rgbprobe'], ['solid(color: base)', 'synth.solid']]) {
    const body = nestedColor(expression)
    const result = reference.compile(header + body)
    assert.deepEqual(result.errors, [])
    const upstream = result.result.plans[0].chain.find(step => step.op === op).args
    const cpu = compile(body).chains[0].steps[1].inlineChains[0].chain.steps.at(-1).params
    const rgb = ({ color, r, g, b }) => color ? color.slice(0, 3) : [r, g, b]
    assert.deepEqual(rgb(cpu), rgb(upstream), expression)
  }
})

test('a let-bound read chain reports the use parameter at the stored read', () => {
  assert.throws(() => compile('let layer = read(o1).invert()\nnoise().blendMode(tex: layer).write(o0)'), {
    name: 'DslError',
    code: 'S001',
    line: 2,
    column: 13,
    message: /Chain for argument 'tex' in blendMode\(\) may contain only effect calls/,
  })
})

test('upstream-saved element ids and let expressions recompile to the same pixels and ids', {
  skip: !process.env.NM_REFERENCE_ROOT,
}, async () => {
  const reference = await loadReferenceCompiler(process.env.NM_REFERENCE_ROOT)
  const renderer = new CpuRenderer({ registry, kernels, kernelFactories })
  const render = source => renderer.render(source, { width: 4, height: 4, time: 0.25 }).toRgba8()
  for (const body of [
    'let t = blendMode(tex: solid(color: #ff0000), mix: 1 / 2)\nnoise().t().write(o0)',
    'let amount = 0.25\nlet t = blendMode(tex: solid(color: #ff0000).invert(), mix: amount)\nnoise().t().write(o0)',
    'noise(_id: "pond", octaves: 3).write(o1, _id: "w")\nread(o1, _id: "r").invert(_id: "flip").write(o0, _id: "out")',
    'noise(_id: "base").blendMode(tex: noise(_id: "over", octaves: 5)).write(o0)',
  ]) {
    const source = header + body + '\nrender(o0)'
    const saved = reference.unparse(source)
    assert.deepEqual(render(saved), render(source), saved)
    const ids = text => compileDsl(text, registry).chains.flatMap(({ steps }) => steps.flatMap(step => [
      step._id, ...(step.inlineChains ?? []).flatMap(({ chain }) => chain.steps.map(inner => inner._id)),
    ])).filter(id => id !== undefined)
    assert.deepEqual(ids(saved), ids(source), saved)
  }
})
