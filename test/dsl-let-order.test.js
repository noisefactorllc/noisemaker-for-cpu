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
`, registry), { code: 'S003', message: /: Variable used before assignment: 'x'$/ })
})

test('a let may reference a later let inside its value expression', () => {
  const program = compileDsl(`
search synth
let a = osc(type: oscKind.sine, speed: b)
let b = 5
noise(scaleX: a).write(o0)
`, registry)
  const descriptor = program.chains[0].steps[0].params.scaleX
  assert.equal(descriptor.type, 'Oscillator')
  assert.equal(descriptor.speed, 5)
})

test('a bare identifier naming a later let reports S003 at declaration', () => {
  assert.throws(() => compileDsl(`
search synth
let a = b
let b = 5
noise(scaleX: a).write(o0)
`, registry), { code: 'S003', message: /: Variable used before assignment$/ })
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

test('a cyclic let set fails with S001 and the authority cycle order', () => {
  for (const [source, cycle] of [
    [
      'let a = osc(type: oscKind.sine, speed: b)\nlet b = osc(type: oscKind.tri, speed: a)\nnoise(scaleX: a).write(o0)',
      'b -> a -> b',
    ],
    [
      'let a = osc(type: oscKind.sine, speed: b)\nlet b = osc(type: oscKind.tri, speed: a)\nnoise(scaleX: b).write(o0)',
      'b -> a -> b',
    ],
    [
      'let a = osc(type: oscKind.sine, speed: b)\nlet b = osc(type: oscKind.tri, speed: a)\nnoise().write(o0)',
      'b -> a -> b',
    ],
    [
      'let a = osc(type: oscKind.sine, speed: b)\nlet b = osc(type: oscKind.tri, speed: c)\nlet c = osc(type: oscKind.saw, speed: a)\nnoise(scaleX: a).write(o0)',
      'c -> a -> b -> c',
    ],
    [
      'let a = osc(type: oscKind.sine, speed: c)\nlet b = osc(type: oscKind.tri, speed: a)\nlet c = osc(type: oscKind.saw, speed: b)\nnoise(scaleX: a).write(o0)',
      'c -> b -> c',
    ],
    [
      'let a = osc(type: oscKind.sine, speed: a)\nnoise().write(o0)',
      'a -> a',
    ],
  ]) {
    assert.throws(
      () => compileDsl(`search synth\n${source}\nrender(o0)`, registry),
      (error) => error.code === 'S001' && error.message.includes(`Automation cycle detected: ${cycle}`),
      source,
    )
  }

  // Multi-effect chain bindings report cycles in left-to-right authority order,
  // not with a pre-pass self-check ahead of referenced lets.
  for (const [source, cycle] of [
    [
      'let a = osc(type: oscKind.sine, speed: b)\nlet b = noise(scaleX: a, scaleY: b).tint()\nnoise().write(o0)',
      'b -> a -> b',
    ],
    [
      'let a = osc(type: oscKind.sine, speed: b)\nlet b = noise(scaleX: b, scaleY: a).tint()\nnoise().write(o0)',
      'b -> b',
    ],
    [
      'let a = osc(type: oscKind.sine, speed: b)\nlet b = noise(scaleX: a).tint(alpha: b)\nnoise().write(o0)',
      'b -> a -> b',
    ],
    [
      'let b = noise(scaleX: b).tint()\nnoise().write(o0)',
      'b -> b',
    ],
    [
      'let b = solid(color: vec3(b, 0, 0)).tint()\nnoise().write(o0)',
      'b -> b',
    ],
    [
      'let b = 2\nlet b = noise(scaleX: b).tint()\nnoise().write(o0)',
      'b -> b',
    ],
  ]) {
    assert.throws(
      () => compileDsl(`search synth, filter\n${source}\nrender(o0)`, registry),
      (error) => error.code === 'S001' && error.message.includes(`Automation cycle detected: ${cycle}`),
      source,
    )
  }
  assert.doesNotThrow(() => compileDsl(`
search synth, filter
let b = noise(scaleX: b, scaleX: 1).tint()
noise().write(o0)
render(o0)
`, registry))

  // Bare identifier self-cycles and identifier copies that close a cycle report
  // S001 at declaration rather than S003 or silently aliasing a cyclic let.
  for (const [source, cycle] of [
    ['let a = a\nnoise().write(o0)', 'a -> a'],
    ['let a = 2\nlet a = a\nnoise(scaleX: a).write(o0)', 'a -> a'],
    ['let a = noise().tint()\nlet a = a\nnoise().write(o0)', 'a -> a'],
    ['let a = noise()\nlet a = a\nnoise().write(o0)', 'a -> a'],
    ['let noise = noise\nsolid().write(o0)', 'noise -> noise'],
    ['let time = time\nnoise().write(o0)', 'time -> time'],
    ['if (true) { let a = a }\nnoise().write(o0)', 'a -> a'],
    ['part p { let a = a\n noise() }\nuse(p).write(o0)', 'a -> a'],
    ['let b = noise(scaleX: a).tint()\nlet a = b\nnoise().write(o0)', 'a -> b -> a'],
    ['let b = noise(scaleX: a)\nlet a = b\nnoise().write(o0)', 'a -> b -> a'],
    ['let b = osc(type: oscKind.sine, speed: a)\nlet a = b\nnoise().write(o0)', 'a -> b -> a'],
  ]) {
    assert.throws(
      () => compileDsl(`search synth, filter\n${source}\nrender(o0)`, registry),
      (error) => error.code === 'S001' && error.message.includes(`Automation cycle detected: ${cycle}`),
      source,
    )
  }
  assert.throws(
    () => compileDsl('search synth\nlet a = b\nlet b = a\nnoise().write(o0)\nrender(o0)', registry),
    { code: 'S003', message: /: Variable used before assignment$/ },
  )

  // Reassigning a name after another let already bound its earlier value is not a cycle.
  const shadowed = compileDsl(`
search synth
let a = 2
let b = osc(type: oscKind.tri, speed: a)
let a = osc(type: oscKind.sine, speed: b)
noise(scaleX: a).write(o0)
render(o0)
`, registry)
  const osc = shadowed.chains[0].steps[0].params.scaleX
  assert.equal(osc.type, 'Oscillator')
  assert.equal(osc.speed.type, 'Oscillator')
  assert.equal(osc.speed.speed, 2)
})

test('a let whose bare identifier names nothing resolvable reports S003 at declaration', () => {
  assert.throws(() => compileDsl(`
search synth
let y = x
noise().write(o0)
`, registry), { code: 'S003', message: /: Variable used before assignment: 'x'$/ })
})

for (const [name, body, message] of [
  ['an unknown if condition', 'noise().write(o0)\nif (zzz) { noise().write(o1) }', "Variable used before assignment: 'zzz'"],
  ['an unknown elif condition', 'noise().write(o0)\nif (0) { noise().write(o1) } elif (zzz) { noise().write(o2) }', "Variable used before assignment: 'zzz'"],
  ['a bare enum namespace in a let', 'let k = oscKind\nnoise().write(o0)', "Variable used before assignment: 'oscKind'"],
  ['an unknown let value', 'let y = zzz\nnoise().write(o0)', "Variable used before assignment: 'zzz'"],
  ['an unknown numeric argument', 'noise(scaleX: zzz).write(o0)', "Variable used before assignment: 'zzz'"],
  ['a later let in a condition', 'noise().write(o0)\nif (b) { noise().write(o1) }\nlet b = 1', 'Variable used before assignment'],
  ['a later let in an argument', 'noise(scaleX: b).write(o0)\nlet b = 2', 'Variable used before assignment'],
  ['an unknown name already in the diagnostic text', 'noise().write(o0)\nif (b) { noise().write(o1) }', 'Variable used before assignment'],
  ['a later name absent from the diagnostic text', 'noise(scaleX: zzz).write(o0)\nlet zzz = 2', "Variable used before assignment: 'zzz'"],
  ['an unknown numeric choice', 'noise(type: zzz).write(o0)', "Variable used before assignment: 'zzz'"],
  ['an unknown boolean argument', 'noise(ridges: zzz).write(o0)', "Variable used before assignment: 'zzz'"],
]) {
  test(`${name} reports the authority's S003 code and message`, () => {
    assert.throws(() => compileDsl(`search synth, filter\nseed 3\n${body}\nrender(o0)`, registry), (error) => {
      assert.equal(error.code, 'S003')
      assert.equal(error.message, `${error.sourceName}:${error.line}:${error.column}: ${message}`)
      return true
    })
  })
}
