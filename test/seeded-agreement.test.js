// Seeded draws agree with upstream. test/fixtures/seeded-agreement.json holds,
// for each program, every draw upstream made (seed, key and uint32) and the
// values of the parameters a random call or an inherited seed set. It is
// recorded by scripts/upstream/seeded-agreement/record.mjs from an upstream
// checkout on the 2.x line, at the commit the fixture names.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry } from '../src/effects/catalog.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/seeded-agreement.json', import.meta.url), 'utf8'))
const registry = await createDefaultRegistry()

// The effect elements of a compiled program in upstream's plan order: an
// effect passed as a value comes before the element that takes it.
function elements(compiled) {
  const out = []
  const visit = (steps) => {
    for (const step of steps) {
      for (const inline of step.inlineChains ?? []) visit(inline.chain.steps)
      if (step.kind === 'effect') out.push(step)
    }
  }
  for (const chain of compiled.chains) visit(chain.steps)
  return out
}

function comparable(value) {
  if (value?.type === 'Oscillator') {
    const { oscType, min, max, speed, offset, seed } = value
    return { type: 'Oscillator', oscType, min, max, speed, offset, seed }
  }
  return value
}

const order = (draws) => [...draws].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.seed - b.seed || a.u - b.u))

test('the fixture comes from the 2.x line and covers programs', () => {
  assert.equal(fixture.branch, '2.x')
  assert.match(fixture.commit, /^[0-9a-f]{40}$/)
  assert.ok(fixture.programs.length > 0)
})

for (const program of fixture.programs) {
  test(`${program.name}: every draw and drawn value matches upstream`, () => {
    const draws = []
    const compiled = compileDsl(program.dsl, registry, { onDraw: (draw) => draws.push(draw) })
    assert.deepEqual(order(draws), order(program.draws))
    // A program with control flow compiles and draws but is not rendered, as
    // upstream's runtime does not execute it: its draws are the agreement.
    if (compiled.controlFlow.length) return
    const steps = elements(compiled)
    assert.deepEqual(steps.map((step) => `${step.definition.namespace}.${step.definition.func}`), program.elements.map((element) => element.op))
    program.elements.forEach((element, index) => {
      for (const [name, value] of Object.entries(element.values)) {
        // A chosen effect is a texture: upstream names a temporary, the port a surface.
        if (value?.kind === 'temp') assert.equal(steps[index].params[name]?.kind, 'surface', `${element.op} #${index} ${name}`)
        else assert.deepEqual(comparable(steps[index].params[name]), value, `${element.op} #${index} ${name}`)
      }
    })
  })
}
