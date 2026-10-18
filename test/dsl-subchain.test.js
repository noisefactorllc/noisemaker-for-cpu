import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { loadReferenceCompiler } from '../scripts/upstream/reference-compiler.js'

// GAP-045. The pinned authority grammar has
//   SubchainCall ::= 'subchain' '(' ArgList? ')' '{' ( '.' Call )+ '}'
// as a chain element. A subchain groups effects and passes its output to the
// next chain element; upstream's validator emits pass-through begin and end
// markers around the body, so a subchain renders as its flattened chain.

const cli = resolve('bin/noisemaker-cpu.js')
const SIZE = 8
const TIME = 0.25
const FLAT = 'search synth, filter\nnoise(seed: 1).invert().posterize(levels: 4).write(o0)\nrender(o0)\n'

// Each accepted program renders the same bytes as FLAT.
const ACCEPTED = [
  'search synth, filter\nnoise(seed: 1).subchain(name: "look") { .invert() .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
  'search synth, filter\nnoise(seed: 1).subchain("look") { .invert() .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
  'search synth, filter\nnoise(seed: 1).subchain(id: "sc1") { .invert() .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
  'search synth, filter\nnoise(seed: 1).subchain(name: "look", id: "sc1") { .invert() .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
  'search synth, filter\nnoise(seed: 1).subchain() { .invert() .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
  // Two blocks in one chain, and a block between ordinary elements.
  'search synth, filter\nnoise(seed: 1).subchain(name: "a") { .invert() }.subchain(name: "b") { .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
  'search synth, filter\nnoise(seed: 1).invert().subchain() { .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
  // The text that the pinned authority unparser writes for the first program.
  'search synth, filter\n\nnoise()\n  .subchain(name: "look") {\n    .invert()\n    .posterize(levels: 4)\n  }\n  .write(o0)\n\nrender(o0)',
  // Comments between body elements.
  'search synth, filter\nnoise(seed: 1)\n  .subchain(name: "look") {\n    // grade\n    .invert()\n    /* steps */ .posterize(levels: 4)\n  }\n  .write(o0)\nrender(o0)\n',
  // Upstream reports these subchain arguments as warnings (P008, P009, P010) and
  // accepts the program: an unknown key, a duplicate key, a missing comma and a
  // trailing comma.
  'search synth, filter\nnoise(seed: 1).subchain(name: "look", color: "red") { .invert() .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
  'search synth, filter\nnoise(seed: 1).subchain(name: "a", name: "b") { .invert() .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
  'search synth, filter\nnoise(seed: 1).subchain(name: "a" id: "b") { .invert() .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
  'search synth, filter\nnoise(seed: 1).subchain(name: "a",) { .invert() .posterize(levels: 4) }.write(o0)\nrender(o0)\n',
]

// Each rejected program fails on the pinned authority and on the port. The port
// reports each one with an existing message template.
const REJECTED = [
  // An empty block.
  ['search synth, filter\nnoise(seed: 1).subchain(name: "x") { }.write(o0)\nrender(o0)\n', /Expected "\."/],
  // A block at the start of a chain.
  ['search synth, filter\nsubchain(name: "x") { .invert() }.write(o0)\nrender(o0)\n', /Expected effect or IO function name/],
  // A generator inside a block.
  ['search synth, filter\nnoise(seed: 1).subchain() { .noise() }.write(o0)\nrender(o0)\n', /Generator synth\/noise must begin a chain/],
  // A read() inside a block.
  ['search synth, filter\nnoise(seed: 1).write(o1)\nread(o1).subchain() { .read(o1) }.write(o0)\nrender(o0)\n', /read\(surface\) must begin a chain/],
  // A write() inside a block, and a nested block.
  ['search synth, filter\nnoise(seed: 1).subchain() { .invert().write(o1) }.write(o0)\nrender(o0)\n', /Expected effect or IO function name/],
  ['search synth, filter\nnoise(seed: 1).subchain() { .write(o1) }.write(o0)\nrender(o0)\n', /Expected effect or IO function name/],
  ['search synth, filter\nnoise(seed: 1).subchain() { .subchain() { .invert() } }.write(o0)\nrender(o0)\n', /Expected effect or IO function name/],
  // A body element without its leading dot.
  ['search synth, filter\nnoise(seed: 1).subchain() { invert() }.write(o0)\nrender(o0)\n', /Expected "\."/],
  // Argument forms that upstream's parseSubchainCall rejects.
  ['search synth, filter\nnoise(seed: 1).subchain(name: 5) { .invert() }.write(o0)\nrender(o0)\n', /Expected "\)"/],
  ['search synth, filter\nnoise(seed: 1).subchain("look", id: "sc1") { .invert() }.write(o0)\nrender(o0)\n', /Expected "\)"/],
  ['search synth, filter\nnoise(seed: 1).subchain(look) { .invert() }.write(o0)\nrender(o0)\n', /Expected "\)"/],
  ['search synth, filter\nnoise(seed: 1).subchain() .invert().write(o0)\nrender(o0)\n', /Expected "\{"/],
  ['search synth, filter\nnoise(seed: 1).subchain() { .invert()\n', /Expected "\."/],
]

function renderBytes(source) {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  return Buffer.from(renderer.render(source, { width: SIZE, height: SIZE, time: TIME, seed: 1 }).toRgba8())
}

test('a subchain block compiles to the steps of its flattened chain', () => {
  const registry = createDefaultRegistry()
  const flat = compileDsl(FLAT, registry).chains[0].steps.map((step) => step.definition?.id ?? step.kind)
  assert.deepEqual(flat, ['synth/noise', 'filter/invert', 'filter/posterize', 'write'])
  for (const source of ACCEPTED) {
    const steps = compileDsl(source, registry).chains[0].steps.map((step) => step.definition?.id ?? step.kind)
    assert.deepEqual(steps, flat, source)
  }
})

test('a program with a subchain block renders the same RGBA bytes as the flattened chain', () => {
  const expected = renderBytes(FLAT)
  for (const source of ACCEPTED) assert.deepEqual(renderBytes(source), expected, source)
})

test('a loopBegin/loopEnd pair inside a subchain renders as the flattened loop', () => {
  const blocked = 'search synth, filter, render\nnoise(seed: 1).subchain(name: "feedback loop", id: "fb1") { .loopBegin(iterationCount: 2) .blur() .loopEnd() }.write(o0)\nrender(o0)\n'
  const flat = 'search synth, filter, render\nnoise(seed: 1).loopBegin(iterationCount: 2).blur().loopEnd().write(o0)\nrender(o0)\n'
  assert.deepEqual(renderBytes(blocked), renderBytes(flat))
})

test('the CLI renders a subchain program to the same PNG as the flattened chain', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-subchain-'))
  try {
    const args = ['render', '-', '--width', String(SIZE), '--height', String(SIZE), '--time', String(TIME), '--output']
    const blocked = spawnSync(process.execPath, [cli, ...args, join(dir, 'blocked.png')], { encoding: 'utf8', input: ACCEPTED[7] })
    const flat = spawnSync(process.execPath, [cli, ...args, join(dir, 'flat.png')], { encoding: 'utf8', input: FLAT })
    assert.equal(blocked.status, 0, blocked.stderr)
    assert.equal(flat.status, 0, flat.stderr)
    assert.deepEqual(await readFile(join(dir, 'blocked.png')), await readFile(join(dir, 'flat.png')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a subchain that the authority rejects still fails', () => {
  const registry = createDefaultRegistry()
  for (const [source, error] of REJECTED) assert.throws(() => compileDsl(source, registry), error, source)
})

test('the pinned authority accepts and rejects the same subchain programs and writes text that the port renders when NM_REFERENCE_ROOT is available', { skip: !process.env.NM_REFERENCE_ROOT }, async () => {
  const reference = await loadReferenceCompiler(process.env.NM_REFERENCE_ROOT)
  const expected = renderBytes(FLAT)
  for (const source of ACCEPTED) {
    const outcome = reference.compile(source)
    assert.equal(outcome.accepted, true, `${source}: ${outcome.errors.join('; ')}`)
    // Round trip: the text that the authority writes for the program renders the
    // flattened chain on the port.
    assert.deepEqual(renderBytes(reference.unparse(source)), expected, source)
  }
  assert.equal(reference.unparse(ACCEPTED[0]), ACCEPTED[7])
  for (const [source] of REJECTED) assert.equal(reference.compile(source).accepted, false, source)
})
