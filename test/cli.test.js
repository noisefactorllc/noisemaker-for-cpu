import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { decodePng, encodePng } from '../src/node/png.js'

const cli = resolve('bin/noisemaker-cpu.js')

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options })
}

test('CLI prints help and the effect catalog', () => {
  const help = run(['--help'])
  const effects = run(['effects'])

  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /Usage: noisemaker-cpu/)
  assert.match(help.stdout, /render PROGRAM/)
  assert.doesNotMatch(help.stdout, /waveform|spectrum/i)
  assert.equal(effects.status, 0, effects.stderr)
  assert.match(effects.stdout, /synth\/noise/)
  assert.match(effects.stdout, /filter\/blur/)
  assert.doesNotMatch(effects.stdout, /synth\/(scope|spectrum|roll)/)
})

test('CLI renders DSL files and stdin to deterministic PNGs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    const program = 'search synth, filter\nnoise(scaleX: 8, scaleY: 8, seed: 3).vignette().write(o0)\nrender(o0)\n'
    const programPath = join(dir, 'program.dsl')
    const fileOut = join(dir, 'file.png')
    const stdinOut = join(dir, 'stdin.png')
    await writeFile(programPath, program)

    const fromFile = run(['render', programPath, '--width', '8', '--height', '6', '--seed', '3', '--output', fileOut])
    const fromStdin = run(['render', '-', '--width=8', '--height=6', '--seed=3', '--output', stdinOut], { input: program })
    assert.equal(fromFile.status, 0, fromFile.stderr)
    assert.equal(fromStdin.status, 0, fromStdin.stderr)
    assert.match(fromFile.stdout, /Rendered 8x6 CPU frame/)
    assert.deepEqual(await readFile(fileOut), await readFile(stdinOut))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI effect command accepts parameters and syntax errors exit non-zero', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    const output = join(dir, 'noise.png')
    const effect = run(['effect', 'noise', '--width', '4', '--height', '4', '--param', 'scaleX=4', '--param', 'scaleY=4', '--output', output])
    const bad = run(['render', '-'], { input: 'this is not DSL' })

    assert.equal(effect.status, 0, effect.stderr)
    assert.equal((await readFile(output)).subarray(1, 4).toString('ascii'), 'PNG')
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /Unknown effect|Missing required search|Expected/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI effect command renders single- and multi-surface mixers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    for (const name of ['mixer/alphaMask', 'mixer/channelCombine']) {
      const output = join(dir, `${name.split('/')[1]}.png`)
      const result = run(['effect', name, '--width=4', '--height=4', '--output', output])
      assert.equal(result.status, 0, `${name}: ${result.stderr}`)
      assert.equal((await readFile(output)).subarray(1, 4).toString('ascii'), 'PNG')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI csl command parses typed uniforms and named sampler textures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    const input = join(dir, 'input.png')
    const colorShader = join(dir, 'color.csl')
    const sampleShader = join(dir, 'sample.csl')
    const colorOutput = join(dir, 'color.png')
    const sampleOutput = join(dir, 'sample.png')
    await writeFile(input, encodePng({ width: 1, height: 1, data: Uint8Array.of(64, 128, 255, 255) }))
    await writeFile(colorShader, 'uniform vec3 color; uniform bool enabled; vec4 main() { return vec4(enabled ? color : vec3(0.0), 1.0); }')
    await writeFile(sampleShader, 'uniform sampler2D inputTex; vec4 main() { return texture(inputTex, uv); }')

    const color = run(['csl', colorShader, '--width=1', '--height=1', '--uniform', 'color=[1,0.5,0]', '--uniform', 'enabled=true', '--output', colorOutput])
    assert.equal(color.status, 0, color.stderr)
    assert.deepEqual([...decodePng(await readFile(colorOutput)).data], [255, 128, 0, 255])

    const sample = run(['csl', sampleShader, '--width=1', '--height=1', '--texture', `inputTex=${input}`, '--output', sampleOutput])
    assert.equal(sample.status, 0, sample.stderr)
    assert.deepEqual([...decodePng(await readFile(sampleOutput)).data], [64, 128, 255, 255])

    const unknown = run(['csl', colorShader, '--width=1', '--height=1', '--uniform', 'missing=1', '--output', colorOutput])
    assert.notEqual(unknown.status, 0)
    assert.match(unknown.stderr, /Unknown CSL uniform "missing"/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI rejects removed reactive effects and audio options', () => {
  for (const effect of ['synth/scope', 'synth/spectrum', 'synth/roll']) {
    const result = run(['effect', effect, '--width=1', '--height=1'])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Unknown effect/)
  }
  const waveform = run(['effect', 'synth/noise', '--waveform', 'samples.json'])
  assert.notEqual(waveform.status, 0)
  assert.match(waveform.stderr, /Unknown option "--waveform"/)
})

test('CLI loads PNG input and named external textures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    const input = join(dir, 'input.png')
    const output = join(dir, 'output.png')
    const program = join(dir, 'media.dsl')
    await writeFile(input, encodePng({
      width: 2,
      height: 2,
      data: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255),
    }))
    await writeFile(program, 'search synth\nmedia(imageSize: [2, 2]).write(o0)\nrender(o0)\n')

    const result = run(['render', program, '--width=2', '--height=2', '--input', input, '--texture', `textTex=${input}`, '--output', output])
    assert.equal(result.status, 0, result.stderr)
    assert.equal((await readFile(output)).subarray(1, 4).toString('ascii'), 'PNG')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
