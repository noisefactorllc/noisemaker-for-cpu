import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CpuRenderer, createDefaultRegistry, kernelFactories } from '../src/index.js'
import { bindCanonicalKernel } from '../src/csl/glsl-kernel.js'
import { decodePng } from '../src/node/png.js'
import { float16Truncate } from '../src/runtime/texture-format.js'
import { compareRgba8 } from '../scripts/parity/lib.js'

// M4 authority captures of seeded hashes: synth3d/noise3d and synth3d/cell3d volumes,
// synth/perlin's 3D path and the synth3d/reactionDiffusion3d seeding pass. Their hash
// words depend on the order in which the authority adds the lattice point, the call's
// constants and the seed term (scripts/upstream/compile-glsl.js,
// lowerSeededLatticeHashes); a left-to-right float32 sum moves whole cells.
const fixtures = new URL('./fixtures/authority/seeded-volumes-m4/', import.meta.url)
const hashFixtures = new URL('./fixtures/authority/seeded-hashes-m4/', import.meta.url)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function loadFixture(directory = fixtures) {
  const fixture = JSON.parse(await readFile(new URL('capture.json', directory), 'utf8'))
  const manifest = JSON.parse(await readFile(new URL('../scripts/upstream/pinned-source-manifest.json', import.meta.url), 'utf8'))
  const pinnedSources = new Map(manifest.entries.map((entry) => [entry.path, entry]))
  const authority = fixture.validation ?? fixture.capture
  // The validation stays at the revision where it ran. Sources the pin has
  // since changed keep their captured record; unchanged sources must still
  // match the pin.
  assert.equal(authority.authorityRevision, 'c4f7cdd7656eb3e3ca8ced6624f19d6474607de8')
  for (const entry of authority.sources) {
    const pinned = pinnedSources.get(entry.path)
    assert.ok(pinned, `${entry.path} is no longer in the pinned manifest`)
    assert.ok((pinned.sha256 === entry.sha256 && pinned.size === entry.size) || pinned.sha256 !== entry.sha256,
      `${entry.path} differs from the captured authority`)
  }
  assert.equal(fixture.tolerance, 2)
  return fixture
}

async function loadReference(kase, width, height, directory = fixtures) {
  assert.equal(sha256(kase.program), kase.programSha256, kase.name)
  const png = await readFile(new URL(kase.image, directory))
  assert.equal(sha256(png), kase.pngSha256, kase.name)
  const reference = decodePng(png)
  assert.deepEqual([reference.width, reference.height], [width, height], kase.name)
  assert.equal(sha256(reference.data), kase.rgbaSha256, kase.name)
  return reference.data
}

test('seeded noise3d and cell3d renders match the M4 authority at 41x23 through every 3D renderer', async () => {
  const fixture = await loadFixture()
  assert.equal(fixture.cases.length, 10)
  const { width, height, time } = fixture
  for (const kase of fixture.cases) {
    const reference = await loadReference(kase, width, height)
    const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
    const actual = renderer.render(kase.program, { width, height, time, seed: kase.seed }).toRgba8()
    const comparison = compareRgba8(actual, reference, fixture.tolerance)
    assert.ok(comparison.pass, `${kase.name}: ${JSON.stringify(comparison)}`)
  }
})

const volumeUniforms = {
  'synth3d/noise3d': { OCTAVES: 1, COLOR_MODE: 0, RIDGES: false, scale: 3, speed: 1 },
  'synth3d/cell3d': { metric: 0, scale: 10, cellVariation: 100, colorMode: 1 },
}

test('seeded noise3d and cell3d 16^3 volume atlases match the M4 authority vol0 readback', async () => {
  const fixture = await loadFixture()
  assert.equal(fixture.volumes.length, 4)
  for (const kase of fixture.volumes) {
    const size = kase.volumeSize
    const width = size
    const height = size * size
    const reference = await loadReference(kase, width, height)
    const uniforms = { ...volumeUniforms[kase.effect], time: kase.time, seed: kase.seed, volumeSize: size }
    const kernel = bindCanonicalKernel(kernelFactories.get(`${kase.effect}:precompute`), { width, height, time: kase.time, seed: kase.seed, uniforms })
    const out = new Float32Array(8)
    const resolution = new Float32Array([width, height])
    const actual = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        kernel({ fragCoord: new Float32Array([x + 0.5, y + 0.5]), uv: new Float32Array([(x + 0.5) / width, (y + 0.5) / height]), resolution }, out)
        // The volume atlas is rgba16f; readPixels returns its rows top-down as round(value * 255).
        const row = height - 1 - y
        for (let channel = 0; channel < 4; channel += 1) {
          actual[(row * width + x) * 4 + channel] = Math.max(0, Math.min(255, Math.round(float16Truncate(out[channel]) * 255)))
        }
      }
    }
    const comparison = compareRgba8(actual, reference, fixture.tolerance)
    assert.ok(comparison.pass, `${kase.name}: ${JSON.stringify(comparison)}`)
  }
})

test('seeded perlin 3D and reactionDiffusion3d renders match the M4 authority', async () => {
  const fixture = await loadFixture(hashFixtures)
  assert.equal(fixture.cases.length, 9)
  for (const kase of fixture.cases) {
    const { width, height, time, seed } = kase
    const reference = await loadReference(kase, width, height, hashFixtures)
    const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
    const actual = renderer.render(kase.program, { width, height, time, seed }).toRgba8()
    const comparison = compareRgba8(actual, reference, fixture.tolerance)
    assert.ok(comparison.pass, `${kase.name}: ${JSON.stringify(comparison)}`)
  }
})
