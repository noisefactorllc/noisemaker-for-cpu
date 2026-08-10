import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { decodePng, encodePng } from '../src/node/png.js'
import { effectCatalog } from '../src/effects/catalog.js'

const cli = resolve('bin/noisemaker-cpu.js')

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options })
}

function hasFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' })
  return !probe.error && probe.status === 0
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

test('CLI effect command renders a filter-kind effect with a surface param via the filter branch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    // render/pointsBillboardRender carries a `tex` (spriteTex) surface param but classifies
    // `kind: 'filter'` (every points/render-namespace effect does - see inferKind in
    // scripts/upstream/inventory.js), so bin/noisemaker-cpu.js's effect-mode auto-wiring takes
    // the single-input branch (`solid().${func}().write(o0)`) and never synthesizes a secondary
    // oN surface for `tex`; the param falls back to its own schema default ("none") instead.
    // iterationCount is pinned to 1 to keep this fast - the filter-vs-mixer wiring under test
    // doesn't depend on how many iterations run. Pins that this renders successfully rather
    // than erroring or hanging.
    const output = join(dir, 'billboard.png')
    const result = run(['effect', 'render/pointsBillboardRender', '--width=4', '--height=4', '--param', 'iterationCount=1', '--output', output])
    assert.equal(result.status, 0, result.stderr)
    const decoded = decodePng(await readFile(output))
    assert.deepEqual([decoded.width, decoded.height], [4, 4])
    assert.ok(decoded.data.every(Number.isFinite))
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

test('CLI generate renders a generator and apply filters an input at its dimensions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    const gen = join(dir, 'gen.png')
    const out = join(dir, 'out.png')
    const generated = run(['generate', 'synth/curl', '--width', '12', '--height', '10', '--seed', '1', '--output', gen])
    assert.equal(generated.status, 0, generated.stderr)
    assert.match(generated.stdout, /^synth\/curl/m) // echoes the resolved effect id
    const source = decodePng(await readFile(gen))
    assert.deepEqual([source.width, source.height], [12, 10])

    const applied = run(['apply', 'filter/invert', gen, '--output', out])
    assert.equal(applied.status, 0, applied.stderr)
    const inverted = decodePng(await readFile(out))
    assert.deepEqual([inverted.width, inverted.height], [12, 10]) // output tracks the input dimensions
    for (let i = 0; i < source.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel += 1) assert.equal(inverted.data[i + channel], 255 - source.data[i + channel])
      assert.equal(inverted.data[i + 3], source.data[i + 3]) // alpha preserved
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI --effect random pools exclude iterated and external-texture effects', async () => {
  // Deterministic pool check, not a statistical one: an iterated effect defaults iterationCount
  // to 60 and can take tens of seconds to minutes at real canvas sizes (see "CPU iteration
  // divergence" in docs/EFFECTS.md), so `random` must never be ABLE to select one - not just be
  // unlikely to. External-texture effects (synth/media, filter/text) are excluded for the mirror
  // reason: `random` binds no image, so picking one exits nonzero. Re-derive pickEffect's own pool
  // predicate against the real catalog and assert every candidate satisfies it.
  for (const kind of ['generator', 'filter']) {
    const excluded = effectCatalog.filter((effect) => effect.kind === kind && effect.iterated === true)
    assert.ok(excluded.length > 0, `expected at least one iterated ${kind} effect to exclude (catalog drift?)`)
    const pool = effectCatalog.filter(
      (effect) => effect.kind === kind && !effect.iterated && !effect.externalTexture,
    )
    assert.ok(pool.length > 0, `expected a non-empty random pool for kind "${kind}"`)
    assert.ok(pool.every((effect) => effect.iterated !== true), `random pool for kind "${kind}" must exclude every iterated effect`)
    assert.ok(pool.every((effect) => !effect.externalTexture), `random pool for kind "${kind}" must exclude every external-texture effect`)
  }
  // synth/media is a generator requiring imageTex: it was reachable by `generate random` before
  // this exclusion and exited 1 whenever it came up.
  assert.equal(effectCatalog.find((effect) => effect.id === 'synth/media')?.externalTexture, 'imageTex')

  // End-to-end: exercise the real CLI dispatch (bin/noisemaker-cpu.js's pickEffect), not just the
  // catalog data above. Small canvas keeps this fast; `--effect random` can genuinely land on any
  // pool member, so a handful of repeats gives real (if not exhaustive) coverage of the wiring.
  const iteratedIds = new Set(effectCatalog.filter((effect) => effect.iterated === true).map((effect) => effect.id))
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    const gen = join(dir, 'gen.png')
    for (let i = 0; i < 8; i += 1) {
      const generated = run(['generate', 'random', '--width', '4', '--height', '4', '--output', gen])
      assert.equal(generated.status, 0, generated.stderr)
      const id = generated.stdout.split('\n')[0].trim()
      assert.ok(!iteratedIds.has(id), `generate random must never pick an iterated effect, picked "${id}"`)
    }
    const base = run(['generate', 'synth/solid', '--width', '4', '--height', '4', '--output', gen])
    assert.equal(base.status, 0, base.stderr)
    for (let i = 0; i < 8; i += 1) {
      const out = join(dir, 'out.png')
      const result = run(['apply', 'random', gen, '--output', out])
      assert.equal(result.status, 0, result.stderr)
      const id = result.stdout.split('\n')[0].trim()
      assert.ok(!iteratedIds.has(id), `apply random must never pick an iterated effect, picked "${id}"`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI run renders DSL from stdin and apply rejects a generator id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    const out = join(dir, 'run.png')
    const program = 'search synth\nsolid(color: #336699).write(o0)\nrender(o0)\n'
    const rendered = run(['run', '--width', '4', '--height', '4', '--output', out], { input: program })
    assert.equal(rendered.status, 0, rendered.stderr)
    assert.deepEqual([...decodePng(await readFile(out)).data.slice(0, 4)], [0x33, 0x66, 0x99, 0xff])

    // apply seeds its input as o0 and reads it, so a generator id can't begin the chain.
    const bad = run(['apply', 'synth/solid', out])
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /must begin a chain|requires an input/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI animate keeps frames when ffmpeg is unavailable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    const frames = join(dir, 'frames')
    // Empty PATH hides ffmpeg; --save-frames makes the fallback keep frames and exit 0.
    const result = run(
      ['animate', 'synth/curl', '--width', '8', '--height', '8', '--frame-count', '2', '--seed', '1', '--save-frames', frames],
      { env: { ...process.env, PATH: '' } },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /ffmpeg not found/)
    assert.equal((await readFile(join(frames, 'frame_0000.png'))).subarray(1, 4).toString('ascii'), 'PNG')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI animate defaults its output to animation.mp4', { skip: !hasFfmpeg() }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'noisemaker-cpu-'))
  try {
    // No --filename: must default to animation.mp4 (never art.png), written into cwd.
    const result = run(['animate', 'synth/curl', '--width', '8', '--height', '8', '--frame-count', '3', '--seed', '1'], { cwd: dir })
    assert.equal(result.status, 0, result.stderr)
    assert.ok((await readFile(join(dir, 'animation.mp4'))).length > 0)
    assert.equal(existsSync(join(dir, 'art.png')), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
