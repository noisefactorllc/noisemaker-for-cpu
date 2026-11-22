import assert from 'node:assert/strict'
import test from 'node:test'

import { CpuRenderer, createDefaultRegistry, kernelFactories } from '../src/index.js'

// A voxel ray that passes through the edge shared by two cell boundaries
// crosses both at one distance and enters the cell beyond the edge. Whether
// the two crossings compare equal depends on rounding. On the center column
// of an odd-width orthographic frame the ray's x and z crossings are equal at
// every step, so the cell there must show the first face its neighbors leave
// exposed, not the first crossed axis in y, x, z order. A white cliff lit
// only from +z shows this: every face the pixels beside the center column
// show, the center column must show too.

const cliff = `search synth, filter, synth3d, render
gradient(type: linear, color1: #000000, color2: #ffffff).threshold(level: 0.5, sharpness: 1).write(o1)
solid(color: #ffffff).write(o2)
heightmap3d(heightTex: read(o1), tex: read(o2), volumeSize: x16, heightScale: 1, baseHeight: 0).renderLandscape3d(lightDirection: vec3(0, 0, 1), ambient: 0, diffuseIntensity: 1, specularIntensity: 0, bgAlpha: 0).write(o0)
render(o0)`

const WIDTH = 129
const HEIGHT = 129
const WHITE = '255,255,255,255'

test('a voxel ray through an edge shows the face its neighbors leave exposed', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
  const frame = renderer.render(cliff, { width: WIDTH, height: HEIGHT }).toRgba8()
  const pixel = (x, y) => {
    const offset = (y * WIDTH + x) * 4
    return `${frame[offset]},${frame[offset + 1]},${frame[offset + 2]},${frame[offset + 3]}`
  }
  const middle = (WIDTH - 1) / 2
  const faceRows = []
  for (let y = 0; y < HEIGHT; y += 1) {
    if (pixel(middle - 1, y) === WHITE && pixel(middle + 1, y) === WHITE) faceRows.push(y)
  }
  assert.ok(faceRows.length > 8, `the center column must cross lit faces through voxel edges, saw ${faceRows.length} rows`)
  const offFace = faceRows.filter((y) => pixel(middle, y) !== WHITE)
  if (offFace.length) {
    assert.fail(`the center column looks at lit faces through voxel edges, and ${offFace.length} of its ${faceRows.length} pixels there show ${pixel(middle, offFace[0])}`)
  }
})
