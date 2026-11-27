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

// Upstream substitutes a value let that chose an effect into the let that names
// it. The port does not key that yet, so it refuses the program rather than
// draw differently.
test('a let that names another let\'s chosen effect is refused for now', () => {
  for (const [source, message] of [
    ['let v = pick(noise(), solid())\nlet w = v\nsolid().blendMode(tex: w).write(o0)', /cannot copy another let's chosen effect yet: 'w'/],
    ['let v = pick(noise(), solid())\nlet b = blendMode(tex: v)\nsolid().b().write(o0)', /cannot take another let's chosen effect yet: 'b'/],
    ['let v = pick(blendMode(tex: noise()), blendMode(tex: solid()))\nsolid().v().write(o0)', /Binding "v" is not callable/],
  ]) {
    assert.throws(() => compile(`search synth, mixer\nseed 3\n${source}`), message, source)
  }
})

test('midi() and audio() refuse the arguments upstream refuses, random ones included', () => {
  for (const [value, message] of [
    ['midi(1, 0, 0, 1, 1, rand(1, 2))', /keyword-only/],
    ['audio(0, 0, 1, rand(1, 2))', /keyword-only/],
    ['midi(rand(0, 1), 2, 3, 4, 5, channel: 1)', /excess positional argument/],
    ['midi(1, foo: rand(0, 1))', /unknown parameter 'foo'/],
    ['midi(1, name: rand(1, 3))', /'name' requires a quoted string/],
  ]) {
    assert.throws(() => compile(`search synth\nseed 5\nlet m = ${value}\nnoise().write(o0)`), message, value)
  }
})
