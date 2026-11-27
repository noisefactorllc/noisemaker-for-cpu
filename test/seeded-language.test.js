// The seed directive and the random constructs, as upstream's language reads
// them: where they may appear, what they refuse, and that a program without
// them compiles as before.
import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDsl } from '../src/dsl/parser.js'
import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry } from '../src/effects/catalog.js'

const registry = await createDefaultRegistry()
const compile = (source, options) => compileDsl(source, registry, options)
const noiseParams = (compiled, chain = 0) => compiled.chains[chain].steps[0].params

test('the seed directive sets the program seed after search', () => {
  assert.equal(parseDsl('search synth\nseed 4294967295\nnoise().write(o0)').seed.value, 4294967295)
  assert.equal(parseDsl('search synth\nseed 0;\nnoise().write(o0)').seed.value, 0)
  assert.equal(parseDsl('search synth\nnoise().write(o0)').seed, null)
})

test('the seed directive refuses a second directive, a bad value and a late position', () => {
  for (const [source, message] of [
    ['search synth\nseed 1\nseed 2\nnoise().write(o0)', /Only one seed directive/],
    ['search synth\nseed 4294967296\nnoise().write(o0)', /whole number from 0 to 4294967295/],
    ['search synth\nseed 1.5\nnoise().write(o0)', /whole number from 0 to 4294967295/],
    ['search synth\nseed -1\nnoise().write(o0)', /whole number from 0 to 4294967295/],
    ['search synth\nseed\nnoise().write(o0)', /whole number from 0 to 4294967295/],
    ['search synth\nnoise().write(o0)\nseed 3', /must appear before other statements/],
    ['seed 3\nnoise().write(o0)', /must follow the search directive/],
  ]) {
    assert.throws(() => parseDsl(source), message, source)
  }
})

test('seed stays an ordinary name everywhere else', () => {
  const compiled = compile('search synth\nlet seed = 7\nnoise(seed: seed).write(o0)')
  assert.equal(noiseParams(compiled).seed, 7)
})

test('the same source and seed draw the same values, and another seed draws others', () => {
  const source = (seed) => `search synth\nseed ${seed}\nnoise(scaleX: rand(1, 100), octaves: randInt(1, 8)).write(o0)`
  assert.deepEqual(noiseParams(compile(source(7))), noiseParams(compile(source(7))))
  assert.notDeepEqual(noiseParams(compile(source(7))), noiseParams(compile(source(8))))
})

test('a program without a seed directive keeps every effect seed as written or its default', () => {
  const compiled = compile('search synth\nnoise().write(o0)\nnoise(seed: 9).write(o1)')
  assert.equal(noiseParams(compiled, 0).seed, registry.resolve('noise', ['synth']).params.seed.default)
  assert.equal(noiseParams(compiled, 1).seed, 9)
})

test('a program without random constructs draws nothing and compiles as before', () => {
  const draws = []
  const source = 'search synth, filter\nlet s = 4\nlet n = noise(scaleX: 3)\nn(scaleY: s).tint(alpha: 0.5).write(o0)\nrender(o0)'
  const compiled = compile(source, { onDraw: (draw) => draws.push(draw) })
  assert.deepEqual(draws, [])
  assert.deepEqual(compiled.chains.map((chain) => chain.steps.map((step) => step.kind === 'effect' ? { id: step.definition.id, params: step.params } : step.kind)),
    [[{ id: 'synth/noise', params: { ...defaults('noise', 'synth'), scaleX: 3, scaleY: 4 } },
      { id: 'filter/tint', params: { ...defaults('tint', 'filter'), alpha: 0.5 } }, 'write']])
})

function defaults(name, namespace) {
  const definition = registry.resolve(name, [namespace])
  return Object.fromEntries(definition.paramNames.map((param) => [param, definition.params[param].default]))
}

test('random calls refuse bad arguments', () => {
  for (const [value, message] of [
    ['rand(1)', /requires both bounds or neither/],
    ['randInt(1)', /requires exactly 2 arguments/],
    ['randInt(1.5, 3)', /whole-number bounds/],
    ['rand(1, 2, 3)', /takes at most 2 arguments/],
    ['rand(lo: 1)', /has no argument 'lo'/],
    ['rand(1, min: 2)', /'min' is passed twice/],
    ['pick()', /needs at least one value/],
    ['pick(1, k: 2)', /pick\(\) has no argument 'k'/],
    ['chance(2) * 1', /probability must be between 0 and 1/],
    ['rand(1, 9, seed: 4294967296)', /seed:\) must be a whole number/],
    ['choices(noise, type)', /Wrap it in pick\(\)/],
    ['pick(choices(noise, nothing))', /has no parameter named 'nothing'/],
    ['pick(choices(noise, scaleX))', /has no choices/],
    ['pick(choices(missing, type))', /unknown effect 'missing'/],
  ]) {
    assert.throws(() => compile(`search synth\nseed 1\nnoise(scaleX: ${value}).write(o0)`), message, value)
  }
})

test('an effect held by a let cannot hold a random call yet, as upstream refuses it', () => {
  assert.throws(() => compile('search synth\nseed 1\nlet n = noise(scaleX: rand(1, 9))\nn().write(o0)'),
    /Random calls in an effect held by a let are not supported yet: 'n'/)
})

test('a random function that a let names is a variable there, not a call', () => {
  assert.throws(() => compile('search synth\nseed 3\nlet rand = 4\nnoise(scaleX: rand(1, 9)).write(o0)'), /'rand' is a variable here and cannot be called/)
  assert.throws(() => compile('search synth\nseed 3\nlet choices = 4\nnoise(type: pick(choices(noise, type))).write(o0)'), /'choices' is a variable here and cannot be called/)
})

test('a random call in an effect passed as a value inside a let that holds an effect is refused too', () => {
  assert.throws(() => compile('search synth, mixer\nseed 3\nlet b = blendMode(tex: noise(scaleX: rand(1, 9)))\nsolid().b().write(o0)'),
    /Random calls in an effect held by a let are not supported yet: 'b'/)
})

// A value let that chose an effect cannot be called as a chain element yet.
test('calling a value let that chose an effect, as an element, is refused for now', () => {
  assert.throws(() => compile('search synth, mixer\nseed 3\nlet v = pick(blendMode(tex: noise()), blendMode(tex: solid()))\nsolid().v().write(o0)'),
    /Binding "v" is not callable/)
})

test('midi() and audio() refuse the arguments upstream refuses, random ones included', () => {
  for (const [value, message] of [
    ['midi(1, 0, 0, 1, 1, rand(1, 2))', /keyword-only/],
    ['audio(0, 0, 1, rand(1, 2))', /keyword-only/],
    ['midi(rand(0, 1), 2, 3, 4, 5, channel: 1)', /excess positional argument/],
    ['midi(1, foo: rand(0, 1))', /unknown parameter 'foo'/],
    ['midi(1, name: rand(1, 3))', /'name' requires a quoted string/],
    ['midi(1, name: "")', /'name' must not be empty/],
    ['midi(1, id: "y", min: rand(0, 1))', /'id' requires readable 'name'/],
    ['midi(mode: rand(0, 1))', /requires 'channel' or 'zone' argument/],
    ['midi(1, zone: 2, min: rand(0, 1))', /'channel' and 'zone' are mutually exclusive/],
    ['midi(1, members: 3)', /'members' requires 'zone'/],
    ['audio(min: rand(0, 1))', /requires 'band' argument/],
    ['audio(0, name: "x", min: rand(0, 1))', /requires both 'name' and 'channel'/],
  ]) {
    // Checked where it is written, whether the let is read or not.
    assert.throws(() => compile(`search synth\nseed 5\nlet m = ${value}\nnoise().write(o0)`), message, value)
    assert.throws(() => compile(`search synth\nseed 5\nnoise(scaleX: ${value}).write(o0)`), message, value)
  }
})

test('an _id: must be an identifier string, and a let carrying one may be used once', () => {
  for (const [source, message] of [
    ['noise(_id: "bad name").write(o0)', /_id: takes a string literal/],
    ['noise(_id: "a", _id: 5).write(o0)', /_id: takes a string literal/],
    ['let a = noise(_id: "x")\na().write(o0)\na().write(o1)', /_id: "x" is in a 'let' value used more than once/],
  ]) {
    assert.throws(() => compile(`search synth\nseed 5\n${source}`), message, source)
  }
})

test('an id shared through lets, nested values or a chosen chain is refused when used twice, and _seed: takes literals only', () => {
  for (const [source, message] of [
    ['let a = blendMode(tex: noise(_id: "x"))\nsolid().a(_id: "p").write(o0)\nsolid().a(_id: "q").write(o1)', /_id: "x" is in a 'let' value used more than once/],
    ['let a = noise(_id: "x")\nlet b = a()\nb().write(o0)\na().write(o1)', /_id: "x" is in a 'let' value used more than once/],
    ['let v = pick(noise(_id: "x"), noise(_id: "y"))\nsolid().blendMode(tex: v).write(o0)\nsolid().blendMode(tex: v).write(o1)', /is in a 'let' value used more than once/],
    ['let n = 3\nnoise(_seed: n).write(o0)', /_seed must be a whole number/],
  ]) {
    assert.throws(() => compile(`search synth, mixer\nseed 3\n${source}`), message, source)
  }
})

test('an id is taken each time an element compiles with it, through lets, values and chosen chains', () => {
  for (const source of [
    'let b = noise(_id: "x")\nlet a = blendMode(tex: b())\nsolid().a().write(o0)\nsolid().a().write(o1)',
    'let b = noise(_id: "x")\nlet c = blendMode(tex: b())\nlet a = c()\nsolid().a().write(o0)\nsolid().c().write(o1)',
    'let p = noise(_id: "x")\nlet v = pick(p(), p())\nsolid().blendMode(tex: v).write(o0)\np().write(o1)',
    'let p = noise(_id: "x")\nlet v = pick(p(), p())\nsolid().blendMode(tex: v).write(o0)\nsolid().blendMode(tex: v).write(o1)',
    'let v = pick(noise(_id: "x"), noise(_id: "x"))\nlet a = blendMode(tex: v)\nsolid().a().write(o0)\nsolid().blendMode(tex: v).write(o1)',
    'let v = pick(noise(_id: "x"), noise(_id: "y"))\nlet w = v\nw().write(o0)\nsolid().blendMode(tex: v).write(o1)',
  ]) {
    assert.throws(() => compile(`search synth, mixer\nseed 3\n${source}`), /is in a 'let' value used more than once/, source)
  }
})

test('parts refuse what upstream refuses', () => {
  for (const [source, message] of [
    ['part p {\n  .tint(_id: "t")\n}\nnoise().use(p).write(o0)', /an _id: inside a part needs an _id: on every use of that part/],
    ['noise().use(p).write(o0)', /No part named 'p'/],
    ['noise().use(p).write(o0)\npart p {\n  .tint()\n}\nnoise().write(o1)', /used before it is declared/],
    ['part p {\n  .tint()\n}\nnoise().use(p, a: 1).write(o0)', /part 'p' has no let 'a'/],
    ['part p {\n  .use(p)\n}\nnoise().use(p).write(o0)', /part nesting is circular/],
    ['part p {\n  .tint()\n}\nuse(p)', /part 'p' continues a chain; use it in a chain/],
    ['part p {\n  .tint()\n}\npart p {\n  .tint()\n}\nnoise().write(o0)', /part 'p' is declared twice/],
    ['maybe(2) {\n  noise().write(o0)\n}', /the probability must be a number between 0 and 1/],
  ]) {
    assert.throws(() => compile(`search synth, filter\nseed 3\n${source}`), message, source)
  }
})

test('part and use refusals that follow upstream after review', () => {
  for (const [source, message] of [
    ['part q {\n  noise(scaleX: rand(1, 9)).write(o0)\n}\npart p {\n  use(q)\n}\nuse(p)', /part 'p' continues a chain; use it in a chain/],
    ['let t = tint(_id: "t")\npart p {\n  .t()\n}\nnoise().use(p).write(o0)', /an _id: inside a part needs an _id: on every use of that part/],
    ['part p {\n  .tint().write(o0)\n}\nnoise().use(p)', /Chain must have explicit write\(\)/],
    ['noise().maybe(1) { .write(o0) }', /Chain must have explicit write\(\)/],
  ]) {
    assert.throws(() => compile(`search synth, filter\nseed 3\n${source}`), message, source)
  }
})

test('chain fragments, chain lets and oscillator lets are refused as upstream refuses them', () => {
  for (const [source, message] of [
    ['part p {\n  .noise(scaleX: rand(1, 9)).write(o0)\n}\nuse(p)', /part 'p' continues a chain; use it in a chain/],
    ['let t = noise(scaleX: rand(1, 9)).tint()\nnoise().write(o0)', /Random calls in an effect held by a let are not supported yet: 't'/],
    ['part p {\n  let c = osc(type: sine, min: 0.1, max: 0.4)\n  .tint(alpha: c)\n}\nnoise().use(p).write(o0)', /Automation cycle detected: c -> c/],
    ['let t = noise(scaleX: t).tint()\nnoise().write(o0)', /Automation cycle detected: t -> t/],
    ['let t = read(o1).tint(alpha: rand(0, 1))\nnoise().write(o0)', /Random calls in an effect held by a let are not supported yet: 't'/],
  ]) {
    assert.throws(() => compile(`search synth, filter, mixer\nseed 3\n${source}`), message, source)
  }
})

// Upstream keys a let of several effects under its own name; the port does not
// key that yet, so it refuses the use rather than draw differently.
test('a let that holds a chain of several effects is refused where it is used, for now', () => {
  assert.throws(() => compile('search synth, filter, mixer\nseed 3\nlet t = noise().tint()\nnoise().blendMode(tex: t).write(o0)'),
    /A let that holds a chain of several effects is not supported yet: 't'/)
})
