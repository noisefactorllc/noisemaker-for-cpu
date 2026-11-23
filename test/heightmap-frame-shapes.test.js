import assert from 'node:assert/strict'
import test from 'node:test'

import { CpuRenderer, createDefaultRegistry, kernelFactories } from '../src/index.js'

// Seen from directly above, the heightmap terrain has the proportions of its
// frame, and empty columns leave margins around it: on a wide frame it spans
// the volume's width and a centered part of its depth, on a tall frame the
// depth and a centered part of the width, and on a square frame all of both.
// The background is transparent, so the opaque pixels of the view bound the
// terrain itself.

const program = (posZ) => `search synth, synth3d, render
heightmap3d(heightTex: solid(color: #ffffff), tex: testPattern(pattern: uvMap), volumeSize: x16, heightScale: 1).renderLandscape3d(viewMode: perspective, rotateX: 1.5708, posZ: ${posZ}, bgAlpha: 0, ambient: 1, diffuseIntensity: 0, specularIntensity: 0).write(o0)
render(o0)`

const frameShapes = [
  { width: 128, height: 128, posZ: -40 },
  { width: 256, height: 128, posZ: -40 },
  { width: 128, height: 256, posZ: -120 },
]

test('seen from above, the terrain is centered with empty margins and keeps the frame proportions', () => {
  const renderer = new CpuRenderer({ registry: createDefaultRegistry(), kernelFactories })
  for (const { width, height, posZ } of frameShapes) {
    const authored = renderer.render('search synth\ntestPattern(pattern: uvMap).write(o0)\nrender(o0)', { width, height }).toRgba8()
    const frame = renderer.render(program(posZ), { width, height }).toRgba8()
    const channels = (source, x, y) => {
      const offset = (y * width + x) * 4
      return [source[offset], source[offset + 1], source[offset + 2]]
    }
    const alphaAt = (x, y) => frame[(y * width + x) * 4 + 3]
    const box = { x0: width, x1: -1, y0: height, y1: -1 }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alphaAt(x, y) === 0) continue
        box.x0 = Math.min(box.x0, x)
        box.x1 = Math.max(box.x1, x)
        box.y0 = Math.min(box.y0, y)
        box.y1 = Math.max(box.y1, y)
      }
    }
    const label = `${width} x ${height} frame`
    assert.ok(box.x1 >= box.x0, `${label}: the terrain must be visible`)
    assert.ok(box.x0 > 0 && box.y0 > 0 && box.x1 < width - 1 && box.y1 < height - 1,
      `${label}: the terrain must leave empty margins (x ${box.x0} to ${box.x1}, y ${box.y0} to ${box.y1})`)
    assert.ok(Math.abs(box.x0 + box.x1 - (width - 1)) <= 3 && Math.abs(box.y0 + box.y1 - (height - 1)) <= 3,
      `${label}: the terrain must be centered (x ${box.x0} to ${box.x1}, y ${box.y0} to ${box.y1})`)
    const boxWidth = box.x1 - box.x0 + 1
    const boxHeight = box.y1 - box.y0 + 1
    const shape = width / height
    assert.ok(Math.abs(boxWidth / boxHeight - shape) <= shape * 0.1,
      `${label}: the terrain measured ${boxWidth} by ${boxHeight} pixels, and its frame is ${width} by ${height}`)
    const dx = Math.round(boxWidth * 0.27)
    const dy = Math.round(boxHeight * 0.27)
    const area = { x0: 0, x1: width - 1, y0: 0, y1: height - 1 }
    const areaWidth = area.x1 - area.x0 + 1
    const areaHeight = area.y1 - area.y0 + 1
    const areaDx = Math.round(areaWidth * 0.27)
    const areaDy = Math.round(areaHeight * 0.27)
    const corners = {
      image: {
        topLeft: channels(authored, area.x0 + areaDx, area.y0 + areaDy),
        topRight: channels(authored, area.x1 - areaDx, area.y0 + areaDy),
        bottomLeft: channels(authored, area.x0 + areaDx, area.y1 - areaDy),
      },
      view: {
        topLeft: channels(frame, box.x0 + dx, box.y0 + dy),
        topRight: channels(frame, box.x1 - dx, box.y0 + dy),
        bottomLeft: channels(frame, box.x0 + dx, box.y1 - dy),
      },
    }
    const across = (rgb) => rgb.topRight[0] - rgb.topLeft[0]
    const down = (rgb) => rgb.bottomLeft[1] - rgb.topLeft[1]
    assert.ok(Math.abs(across(corners.image)) > 64 && Math.abs(down(corners.image)) > 64,
      `${label}: the uvMap reference must vary along both axes`)
    assert.ok(Math.sign(across(corners.view)) === Math.sign(across(corners.image)) && Math.abs(across(corners.view)) > 64,
      `${label}: image right must be screen right`)
    assert.ok(Math.sign(down(corners.view)) === Math.sign(down(corners.image)) && Math.abs(down(corners.view)) > 64,
      `${label}: image top must be screen top`)
    assert.ok(Math.abs(corners.view.bottomLeft[0] - corners.view.topLeft[0]) <= 24
      && Math.abs(corners.view.topRight[1] - corners.view.topLeft[1]) <= 24,
      `${label}: the image must not be rotated`)
  }
})
