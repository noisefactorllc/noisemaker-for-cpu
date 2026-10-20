import test from 'node:test'
import assert from 'node:assert/strict'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry } from '../src/effects/catalog.js'

// Mirrors upstream commit 9cc041d0 (statement-order lets): a chain sees only
// the lets declared at or before its own statement index, a later let of the
// same name reassigns it for later chains, and reading a pending name reports
// S003. Lets may still refer to each other in any order.
const registry = createDefaultRegistry()

test('a chain uses the latest let declared before it, and reassignment is allowed', () => {
  const program = compileDsl(`
search synth
let x = 10
noise(scaleX: x).write(o0)
let x = 90
noise(scaleX: x).write(o1)
`, registry)
  assert.equal(program.chains[0].steps[0].params.scaleX, 10)
  assert.equal(program.chains[1].steps[0].params.scaleX, 90)
})

test('a chain reading a let declared by a later statement reports S003', () => {
  assert.throws(() => compileDsl(`
search synth
noise(scaleX: x).write(o0)
let x = 20
`, registry), (error) => error.message.includes("Variable used before assignment: 'x'"))
})

test('a let may reference a later let inside its value expression', () => {
  const program = compileDsl(`
search synth
let a = b + 1
let b = 5
noise(scaleX: a).write(o0)
`, registry)
  assert.equal(program.chains[0].steps[0].params.scaleX, 6)
})

test('a bare identifier naming a later let reports S003 at declaration', () => {
  assert.throws(() => compileDsl(`
search synth
let a = b
let b = 5
noise(scaleX: a).write(o0)
`, registry), (error) => error.message.includes("Variable used before assignment: 'b'"))
})

test('a value call may reference a later let in its arguments', () => {
  const program = compileDsl(`
search synth
let outer = osc(type: oscKind.sine, speed: inner)
let inner = osc(type: oscKind.tri, speed: 2)
noise(scaleX: outer).write(o0)
`, registry)
  const descriptor = program.chains[0].steps[0].params.scaleX
  assert.equal(descriptor.type, 'Oscillator')
  assert.equal(descriptor.oscType, 0)
  assert.equal(descriptor.speed.type, 'Oscillator')
  assert.equal(descriptor.speed.oscType, 1)
  assert.equal(descriptor.speed.speed, 2)
})

test('a cyclic let set fails with a cycle report', () => {
  assert.throws(() => compileDsl(`
search synth
let a = b + 1
let b = a + 1
noise(scaleX: a).write(o0)
`, registry), (error) => error.message.includes('Automation cycle detected: a -> b -> a'))
})

test('a let whose bare identifier names nothing resolvable reports S003 at declaration', () => {
  assert.throws(() => compileDsl(`
search synth
let y = x
noise().write(o0)
`, registry), (error) => error.message.includes("Variable used before assignment: 'x'"))
})
