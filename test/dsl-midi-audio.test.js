import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isAutomationValue } from '../src/runtime/automation.js'
import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry } from '../src/effects/catalog.js'

const cli = resolve('bin/noisemaker-cpu.js')

for (const call of ['midi(channel: 1, min: 0.8)', 'audio(band: audioBand.low, min: 0.8)']) {
  test(`${call.split('(')[0]}() warns and leaves the offline parameter default`, { timeout: 15_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cpu-unsupported-input-'))
    try {
      const render = (source, name) => spawnSync(process.execPath, [cli, 'render', '-',
        '--width', '8', '--height', '8', '--seed', '1', '--time', '0.25',
        '--output', join(dir, name)], { encoding: 'utf8', input: source, timeout: 10_000 })
      const source = `search synth\nnoise(seed: 1, scaleX: ${call}).write(o0)\nrender(o0)`
      const ignored = render(source, 'ignored.png')
      const baseline = render('search synth\nnoise(seed: 1).write(o0)\nrender(o0)', 'baseline.png')
      assert.equal(ignored.status, 0, ignored.stderr)
      assert.equal(baseline.status, 0, baseline.stderr)
      assert.match(ignored.stderr, /Warning: (midi|audio)\(\) is unsupported in CPU ports; real-time input is unavailable/)
      assert.deepEqual(await readFile(join(dir, 'ignored.png')), await readFile(join(dir, 'baseline.png')))
      assert.equal(baseline.stderr, '')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}

test('real-time descriptors are not CPU automation values', () => {
  assert.equal(isAutomationValue({ type: 'Midi' }), false)
  assert.equal(isAutomationValue({ type: 'Audio' }), false)
  assert.equal(isAutomationValue({ type: 'Oscillator' }), true)
})

for (const source of [
  'search synth\nlet rate = midi(channel: 1, min: 0.8)\nnoise(scaleX: rate).write(o0)\nrender(o0)',
  'search synth\nnoise(scaleX: osc(type: sine, speed: audio(band: low))).write(o0)\nrender(o0)',
]) {
  test('unsupported input in bindings or oscillator fields warns without creating live automation', (t) => {
    const warnings = t.mock.method(console, 'warn', () => {})
    const plan = compileDsl(source, createDefaultRegistry())
    assert.equal(warnings.mock.callCount(), 1)
    const value = plan.chains[0].steps[0].params.scaleX
    if (isAutomationValue(value)) assert.equal(value.speed, 1)
    else assert.equal(value, createDefaultRegistry().resolve('noise', ['synth']).params.scaleX.default)
  })
}
