import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry, kernelFactories, kernels } from '../src/effects/catalog.js'
import { evaluateAutomation, isAutomationValue, resolveAutomationUniform } from '../src/runtime/automation.js'
import { CpuRenderer } from '../src/runtime/renderer.js'
import { loadReferenceCompiler } from '../scripts/upstream/reference-compiler.js'

// GAP-044. The pinned authority parses midi(...) and audio(...) as numeric
// automation values. With no MIDI or audio input, each one resolves to its
// `min` field, and the consumer parameter scales that value into its range.
//
// Each case is one value for noise(seed: 1, <param>: <value>). `resolved` is
// the value that the pinned authority (6cb1a3c3) uses at time 0.25: its
// validator output passed through Pipeline.prototype.resolveUniformValue with
// no external state. The last test re-proves every entry against a live tree.

const cli = resolve('bin/noisemaker-cpu.js')
const TIME = 0.25
const SIZE = 8

const ACCEPTED = [
  // Forms that the authority unparser writes (formatMidi, formatAudio).
  { param: 'scaleX', value: 'midi(channel: 1, mode: midiMode.velocity, min: 0.25, max: 0.75)', resolved: 25.75 },
  { param: 'scaleX', value: 'midi(channel: 1)', resolved: 1 },
  { param: 'scaleX', value: 'midi(channel: 2, mode: midiMode.cc, cc: 7, min: 0.3, max: 0.8, sensitivity: 2)', resolved: 30.7 },
  { param: 'scaleX', value: 'midi(zone: midiZone.lower, members: 3, min: 0.6)', resolved: 60.4 },
  { param: 'scaleX', value: 'midi(channel: 1, mode: midiMode.nrpn, nrpn: 300, min: 0.15, sensitivity: 2, name: "Port A", id: "abc")', resolved: 15.85 },
  { param: 'scaleX', value: 'audio(band: audioBand.low, min: 0.25, max: 0.75)', resolved: 25.75 },
  { param: 'scaleX', value: 'audio(band: audioBand.vol, min: 0.55, channel: 3, name: "Mic", id: "dev-1")', resolved: 55.45 },
  { param: 'scaleX', value: 'audio(band: audioBand.raw, min: 0.65)', resolved: 65.35000000000001 },
  // Positional and mixed positional/keyword arguments.
  { param: 'scaleX', value: 'midi(1, midiMode.noteChange, 0.4, 0.9)', resolved: 40.6 },
  { param: 'scaleX', value: 'midi(2, min: 0.3, mode: midiMode.cc, cc: 7)', resolved: 30.7 },
  { param: 'scaleX', value: 'audio(audioBand.mid, 0.35, 0.8)', resolved: 35.65 },
  { param: 'scaleX', value: 'audio(audioBand.high, 0.45, channel: 2)', resolved: 45.550000000000004 },
  // let variables that hold an automation value.
  { param: 'scaleX', value: 'bass', lets: 'let bass = audio(band: audioBand.low, min: 0.25, max: 0.75)\n', resolved: 25.75 },
  { param: 'scaleX', value: 'rate', lets: 'let floor = audio(band: audioBand.low, min: 0.3)\nlet rate = midi(channel: 1, min: floor, max: 1)\n', resolved: 30.7 },
  // Nested automation in both directions.
  { param: 'scaleX', value: 'osc(type: oscKind.sine, min: 0.25, max: 0.75, speed: audio(band: audioBand.low, min: 0, max: 1))', resolved: 25.75 },
  { param: 'scaleX', value: 'osc(type: oscKind.tri, min: midi(channel: 3, min: 0.2), max: audio(band: audioBand.mid, min: 0.7))', resolved: 45.55 },
  { param: 'scaleX', value: 'midi(channel: 1, min: osc(type: oscKind.tri, min: 0.2, max: 0.6))', resolved: 40.6 },
  { param: 'scaleX', value: 'audio(band: audioBand.low, min: osc(type: oscKind.saw, min: 0.1, max: 0.5))', resolved: 20.8 },
  // An int parameter without choices gets the unrounded scaled value (upstream
  // uniformSpecs has no `type: 'int'` for it). The int uniform takes 4, as
  // WebGL2 uniform1i truncates 4.5, so the literal program uses 4.
  { param: 'octaves', value: 'audio(band: audioBand.low, min: 0.5)', resolved: 4.5, literal: 4 },
  // The authority accepts these with a warning (S002) and falls back.
  { param: 'scaleX', value: 'midi(channel: 20, min: 0.25)', resolved: 25.75 },
  { param: 'scaleX', value: 'midi(channel: 1, mode: midiMode.bogus, min: 0.25)', resolved: 25.75 },
  { param: 'scaleX', value: 'midi(channel: 1, mode: midiMode.nrpn, min: 0.25)', resolved: 25.75 },
  { param: 'scaleX', value: 'midi(zone: midiZone.lower, members: 0)', resolved: 1 },
  { param: 'scaleX', value: 'midi(channel: 1, min: true)', resolved: 100 },
  { param: 'scaleX', value: 'midi(channel: 1, min: 1.5)', resolved: 100 },
  { param: 'scaleX', value: 'audio(band: audioBand.low, min: 0.25, channel: 40)', resolved: 25.75 },
  { param: 'scaleX', value: 'audio(band: audioBand.bogus, min: 0.25)', resolved: 25.75 },
  { param: 'scaleX', value: 'audio(band: audioBand.low, min: true)', resolved: 1 },
  { param: 'scaleX', value: 'audio(band: audioBand.low, min: osc(type: oscKind.saw, min: 0.1, max: 0.5), channel: 40)', resolved: 1 },
]

// Arguments that the authority rejects. Each error names the call.
const REJECTED = [
  { value: 'midi(channel: 1, wobble: 2)', error: /midi\(\) unknown parameter 'wobble'/ },
  { value: 'midi(min: 0.5)', error: /midi\(\) requires 'channel' or 'zone' argument/ },
  { value: 'midi(1, 2, 3, 4, 5, 6)', error: /midi\(\) name, id, cc, nrpn, zone and members are keyword-only/ },
  { value: 'midi(channel: 1, zone: midiZone.lower)', error: /midi\(\) 'channel' and 'zone' are mutually exclusive/ },
  { value: 'midi(channel: 1, members: 3)', error: /midi\(\) 'members' requires 'zone'/ },
  { value: 'midi(channel: 1, id: "x")', error: /midi\(\) 'id' requires readable 'name'/ },
  { value: 'midi(channel: 1, name: "")', error: /midi\(\) 'name' must not be empty/ },
  { value: 'midi(channel: 1, name: port)', error: /midi\(\) 'name' requires a quoted string/ },
  { value: 'midi(channel: "1")', error: /String literal not allowed for midi\(\) channel/ },
  { value: 'midi(channel: 1, mode: "cc")', error: /String literal not allowed for midi\(\) mode/ },
  { value: 'midi(channel: foo)', error: /Undefined automation source 'foo' for midi\(\) channel/ },
  { value: 'audio(min: 0.5)', error: /audio\(\) requires 'band' argument/ },
  { value: 'audio(audioBand.low, 0, 1, 2)', error: /audio\(\) channel, name and id are keyword-only/ },
  { value: 'audio(band: audioBand.low, name: "Mic")', error: /audio\(\) selected device requires both 'name' and 'channel'/ },
  { value: 'audio(band: "low")', error: /String literal not allowed for audio\(\) band/ },
  { value: 'audio(band: audioBand.low, channel: "2")', error: /String literal not allowed for audio\(\) channel/ },
  { value: 'audio(band: audioBand.low, min: "0.2")', error: /String literal not allowed for audio\(\) min/ },
  { value: 'audio(band: audioBand.low, min: lowish)', error: /Undefined automation source 'lowish' for audio\(\) min/ },
]

function program(param, value, lets = '') {
  return `search synth\n${lets}noise(seed: 1, ${param}: ${value}).write(o0)\nrender(o0)\n`
}

// The consumer range that upstream's expander builds (uniformSpecs) for a float
// or int parameter without choices.
function specFor(param) {
  return param === 'octaves' ? { min: 1, max: 8 } : { min: 1, max: 100 }
}

function renderBytes(source) {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories })
  return Buffer.from(renderer.render(source, { width: SIZE, height: SIZE, time: TIME, seed: 1 }).toRgba8())
}

function compiledValue(param, value, lets) {
  const plan = compileDsl(program(param, value, lets), createDefaultRegistry())
  return plan.chains[0].steps[0].params[param]
}

test('midi() and audio() values compile to automation values that resolve to the authority value with no input', () => {
  for (const { param, value, lets, resolved } of ACCEPTED) {
    const compiled = compiledValue(param, value, lets)
    assert.equal(isAutomationValue(compiled), true, value)
    assert.equal(resolveAutomationUniform(compiled, TIME, specFor(param)), resolved, value)
  }
})

test('a program with midi() or audio() renders the same RGBA bytes as the literal value the authority uses', () => {
  for (const { param, value, lets, resolved, literal = resolved } of ACCEPTED) {
    assert.deepEqual(renderBytes(program(param, value, lets)), renderBytes(program(param, String(literal))), value)
  }
})

test('the CLI renders midi() and audio() programs to the same PNG as the literal value', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-midi-audio-'))
  try {
    const picks = ACCEPTED.filter(({ value }) => ['midi(channel: 1, mode: midiMode.velocity, min: 0.25, max: 0.75)', 'audio(band: audioBand.low, min: 0.25, max: 0.75)', 'bass', 'midi(2, min: 0.3, mode: midiMode.cc, cc: 7)'].includes(value))
    assert.equal(picks.length, 4)
    for (const [index, { param, value, lets, resolved }] of picks.entries()) {
      const args = ['render', '-', '--width', String(SIZE), '--height', String(SIZE), '--time', String(TIME), '--output']
      const automated = spawnSync(process.execPath, [cli, ...args, join(dir, `${index}-a.png`)], { encoding: 'utf8', input: program(param, value, lets) })
      const literal = spawnSync(process.execPath, [cli, ...args, join(dir, `${index}-b.png`)], { encoding: 'utf8', input: program(param, String(resolved)) })
      assert.equal(automated.status, 0, `${value}: ${automated.stderr}`)
      assert.equal(literal.status, 0, literal.stderr)
      assert.deepEqual(await readFile(join(dir, `${index}-a.png`)), await readFile(join(dir, `${index}-b.png`)), value)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('midi() and audio() arguments that the authority rejects fail with an error that names the call', () => {
  const registry = createDefaultRegistry()
  for (const { value, error } of REJECTED) {
    assert.throws(() => compileDsl(program('scaleX', value), registry), error, value)
  }
})

test('the no-input evaluator returns min, and invalid audio() falls back to a literal min', () => {
  const unit = { min: 0, max: 1 }
  assert.equal(evaluateAutomation({ type: 'Midi', channel: 1, mode: 4, min: 0.4, max: 0.9, sensitivity: 1 }, TIME, unit), 0.4)
  assert.equal(evaluateAutomation({ type: 'Audio', band: 0, min: 0.3, max: 1, _invalid: false }, TIME, unit), 0.3)
  const nested = { type: 'Oscillator', oscType: 2, min: 0.1, max: 0.5, speed: 1, offset: 0, seed: 1 }
  assert.equal(evaluateAutomation({ type: 'Audio', band: 0, min: nested, max: 1, _invalid: true }, TIME, unit), 0)
  assert.equal(evaluateAutomation({ type: 'Audio', band: 0, min: 0.2, max: 1, _invalid: true }, TIME, unit), 0.2)
})

test('midi() and audio() verdicts and values match the pinned authority when NM_REFERENCE_ROOT is available', { skip: !process.env.NM_REFERENCE_ROOT }, async () => {
  const root = process.env.NM_REFERENCE_ROOT
  const reference = await loadReferenceCompiler(root)
  const { Pipeline } = await import(pathToFileURL(join(root, 'shaders', 'src', 'runtime', 'pipeline.js')).href)
  for (const { param, value, lets, resolved } of ACCEPTED) {
    const outcome = reference.compile(program(param, value, lets))
    assert.equal(outcome.accepted, true, `${value}: ${outcome.errors.join('; ')}`)
    const step = outcome.result.plans[0].chain.find((entry) => entry.op === 'synth.noise')
    const live = Pipeline.prototype.resolveUniformValue.call({ externalState: null }, step.args[param], TIME, specFor(param))
    assert.equal(live, resolved, value)
  }
  for (const { value } of REJECTED) {
    assert.equal(reference.compile(program('scaleX', value)).accepted, false, value)
  }
})
