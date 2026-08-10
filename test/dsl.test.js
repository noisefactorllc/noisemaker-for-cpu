import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDsl } from '../src/dsl/parser.js'
import { compileDsl } from '../src/dsl/compiler.js'
import { EffectDefinition } from '../src/effects/definition.js'
import { EffectRegistry } from '../src/effects/registry.js'
import { createDefaultRegistry } from '../src/effects/catalog.js'

function registry() {
  const out = new EffectRegistry()
  out.register(new EffectDefinition({
    namespace: 'synth',
    func: 'noise',
    kind: 'generator',
    params: {
      scale: { type: 'float', default: 4 },
      seed: { type: 'int', default: 1 },
    },
    passes: [{ kernel: 'synth/noise/main' }],
  }))
  out.register(new EffectDefinition({
    namespace: 'synth',
    func: 'solid',
    kind: 'generator',
    params: { color: { type: 'color', default: [0.5, 0.5, 0.5] } },
    passes: [{ kernel: 'synth/solid/main' }],
  }))
  out.register(new EffectDefinition({
    namespace: 'filter',
    func: 'posterize',
    kind: 'filter',
    params: { levels: { type: 'int', default: 4, min: 2 } },
    passes: [{ kernel: 'filter/posterize/main' }],
  }))
  out.register(new EffectDefinition({
    namespace: 'mixer',
    func: 'blendMode',
    kind: 'mixer',
    params: {
      other: { type: 'surface' },
      mode: { type: 'enum', default: 0, choices: { normal: 0, multiply: 1 } },
    },
    passes: [{ kernel: 'mixer/blendMode/main' }],
  }))
  out.register(new EffectDefinition({
    namespace: 'mixer',
    func: 'combineSurfaces',
    kind: 'mixer',
    params: { source: { type: 'surface' } },
    passes: [{ program: 'combineSurfaces', inputs: { source: 'source' }, outputs: { fragColor: 'outputTex' } }],
  }))
  return out
}

const PROGRAM = `
search synth, filter, mixer
let levels = 5
let tuned = noise(scale: 7)
tuned(seed: 11).posterize(levels: levels).write(o0)
solid(color: #f80).write(o1)
read(o0).blendMode(other: o1, mode: multiply).write(o2)
render(o2)
`

test('DSL parser retains search order, values, partials, chains, and render', () => {
  const ast = parseDsl(PROGRAM, { sourceName: 'program.dsl' })

  assert.deepEqual(ast.search, ['synth', 'filter', 'mixer'])
  assert.equal(ast.bindings.length, 2)
  assert.equal(ast.chains.length, 3)
  assert.equal(ast.chains[0].calls[0].name, 'tuned')
  assert.deepEqual(ast.chains[1].calls[0].args[0].value, [1, 136 / 255, 0])
  assert.equal(ast.render.name, 'o2')
})

test('DSL compiler resolves partials, values, enums, and surface reads/writes', () => {
  const plan = compileDsl(PROGRAM, registry(), { sourceName: 'program.dsl' })

  assert.equal(plan.chains.length, 3)
  assert.equal(plan.chains[0].steps[0].definition.id, 'synth/noise')
  assert.deepEqual(plan.chains[0].steps[0].params, { scale: 7, seed: 11 })
  assert.deepEqual(plan.chains[0].steps[1].params, { levels: 5 })
  assert.deepEqual(plan.chains[2].steps.map((step) => step.kind), ['read', 'effect', 'write'])
  assert.equal(plan.chains[2].steps[1].params.other.name, 'o1')
  assert.equal(plan.chains[2].steps[1].params.mode, 1)
  assert.equal(plan.renderSurface, 'o2')
})

test('DSL accepts canonical read(oN) surface arguments', () => {
  const plan = compileDsl(`
    search synth, mixer
    solid(color: #f80).write(o0)
    noise().blendMode(other: read(o0), mode: multiply).write(o1)
    render(o1)
  `, registry())

  assert.equal(plan.chains[1].steps[1].params.other.name, 'o0')
})

test('DSL defaults render output to the last written surface', () => {
  const plan = compileDsl(`
    search synth
    solid(color: #f80).write(o0)
    noise().write(o1)
  `, registry())

  assert.equal(plan.renderSurface, 'o1')
})

test('DSL permits surface-combining effects to start a chain without inputTex', () => {
  const plan = compileDsl(`
    search synth, mixer
    noise().write(o0)
    combineSurfaces(source: read(o0)).write(o1)
  `, registry())

  assert.deepEqual(plan.chains[1].steps.map((step) => step.kind), ['effect', 'write'])
  assert.equal(plan.chains[1].steps[0].params.source.name, 'o0')
})

test('DSL supports positional arguments and vector literals', () => {
  const ast = parseDsl('search synth\nsolid([0.1, 0.2, 0.3]).write(o0)\nrender(o0)')
  assert.deepEqual(ast.chains[0].calls[0].args[0].value, [0.1, 0.2, 0.3])
  const plan = compileDsl('search synth\nnoise(8, 2).write(o0)\nrender(o0)', registry())
  assert.deepEqual(plan.chains[0].steps[0].params, { scale: 8, seed: 2 })
})

test('DSL rejects missing search, mixed arguments, unknown effects, and invalid params', () => {
  assert.throws(() => compileDsl('noise().write(o0)\nrender(o0)', registry()), /Missing required search directive/)
  assert.throws(() => parseDsl('search synth\nnoise(4, seed: 2).write(o0)'), /Cannot mix positional and named arguments/)
  assert.throws(() => compileDsl('search synth\nwat().write(o0)\nrender(o0)', registry()), /Unknown effect "wat" in search namespaces synth/)
  assert.throws(() => compileDsl('search synth\nnoise(bogus: 1).write(o0)\nrender(o0)', registry()), /Unknown parameter "bogus".*scale, seed/)
})

test('DSL requires materialized generator chains and valid surface references', () => {
  assert.throws(() => compileDsl('search synth\nnoise()\nrender(o0)', registry()), /Generator chain must end with write/)
  assert.throws(() => compileDsl('search synth', registry()), /No render surface specified and no write\(\) found/)
  assert.throws(() => parseDsl('search synth\nnoise().write(o9)'), /Surface reference must be o0 through o7/)
})

// `render` is both a reserved directive keyword (`render(oN)`) and a real catalog namespace
// (owning `pointsEmit`/`pointsRender`/`pointsBillboardRender`). These three tests cover the
// context-sensitive parser fix that lets `search` accept it as a namespace without disturbing
// the `render(oN)` directive parse elsewhere in the same program.
test('DSL search list accepts the render keyword as a namespace and resolves pointsEmit', () => {
  const program = 'search synth, points, render\nperlin().pointsEmit().write(o0)\nrender(o0)'
  const ast = parseDsl(program)
  assert.deepEqual(ast.search, ['synth', 'points', 'render'])

  const plan = compileDsl(program, createDefaultRegistry())
  assert.equal(plan.chains[0].steps[1].definition.id, 'render/pointsEmit')
})

test('DSL render(oN) directive still parses in a program whose search list includes render', () => {
  const program = 'search synth, points, render\nperlin().pointsEmit().write(o0)\nrender(o0)'
  const ast = parseDsl(program)
  assert.equal(ast.render.name, 'o0')
  assert.equal(ast.chains.length, 1)
  assert.equal(ast.chains[0].calls.length, 3) // perlin, pointsEmit, write - "render" was not swallowed as a call
})

test('DSL compiles a program combining a render-namespace search entry, chained particle effects, and write(oN)', () => {
  const plan = compileDsl(
    'search synth, points, render\nperlin(seed: 0).pointsEmit(seed: 0).physical().pointsRender().write(o0)\nrender(o0)',
    createDefaultRegistry(),
  )
  assert.equal(plan.renderSurface, 'o0')
  assert.deepEqual(
    plan.chains[0].steps.map((step) => step.definition?.id ?? step.kind),
    ['synth/perlin', 'render/pointsEmit', 'points/physical', 'render/pointsRender', 'write'],
  )
})

test('DSL compiles a volume generator, volume filter, and volume renderer as one typed chain', () => {
  // Break caught: treating a volume-only generator as an ordinary image generator lets it be
  // written directly and loses the volume/geometry channels before render3d consumes them.
  const plan = compileDsl(`
    search synth3d, filter3d, render
    noise3d(volumeSize: 16).palette3d(volumeSize: 16).render3d(volumeSize: 16).write(o0)
    render(o0)
  `, createDefaultRegistry())

  assert.deepEqual(
    plan.chains[0].steps.filter((step) => step.kind === 'effect').map((step) => step.definition.domain),
    ['volume-generator', 'volume-filter', 'volume-renderer'],
  )
})

test('DSL lets an iterated volume generator consume an upstream volume without relaxing ordinary generator placement', () => {
  const registry = createDefaultRegistry()
  const plan = compileDsl(`
    search synth3d, render
    noise3d(volumeSize: x32)
      .reactionDiffusion3d(volumeSize: x32, iterationCount: 1)
      .render3d(volumeSize: v32)
      .write(o0)
    render(o0)
  `, registry)

  assert.deepEqual(
    plan.chains[0].steps.filter((step) => step.kind === 'effect').map((step) => step.definition.id),
    ['synth3d/noise3d', 'synth3d/reactionDiffusion3d', 'render/render3d'],
  )
  assert.throws(
    () => compileDsl('search synth3d\nnoise3d().shape3d().write(o0)', registry),
    /Generator synth3d\/shape3d must begin a chain/,
  )
})

test('DSL rejects missing volume inputs and writing a volume-only chain', () => {
  const registry = createDefaultRegistry()
  assert.throws(
    () => compileDsl('search synth, filter3d\nsolid().palette3d().write(o0)', registry),
    /volume filter filter3d\/palette3d requires a volume input/,
  )
  assert.throws(
    () => compileDsl('search synth, render\nsolid().render3d().write(o0)', registry),
    /volume renderer render\/render3d requires a volume input/,
  )
  assert.throws(
    () => compileDsl('search synth3d\nnoise3d(volumeSize: 16).write(o0)', registry),
    /write\(surface\) requires a current image/,
  )
})

test('DSL accepts one balanced accumulator loop and rejects malformed loop markers', () => {
  const registry = createDefaultRegistry()
  const plan = compileDsl(`
    search synth, filter, render
    solid().loopBegin(iterationCount: 3).blur().loopEnd().write(o0)
    render(o0)
  `, registry)
  assert.deepEqual(
    plan.chains[0].steps.filter((step) => step.kind === 'effect').map((step) => step.definition.loopRole ?? null),
    [null, 'begin', null, 'end'],
  )

  assert.throws(
    () => compileDsl('search synth, render\nsolid().loopEnd().write(o0)', registry),
    /loopEnd has no matching loopBegin/,
  )
  assert.throws(
    () => compileDsl('search synth, render\nsolid().loopBegin().write(o0)', registry),
    /loopBegin must be closed by loopEnd before write/,
  )
  assert.throws(
    () => compileDsl('search synth, render\nsolid().loopBegin().loopBegin().loopEnd().loopEnd().write(o0)', registry),
    /nested loopBegin regions are not supported/,
  )
})
