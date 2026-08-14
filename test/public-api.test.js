import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function browserImportGraph(entry) {
  const visited = new Set()
  async function visit(path) {
    if (visited.has(path)) return
    visited.add(path)
    const source = await readFile(path, 'utf8')
    const imports = [...source.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)].map((match) => match[1])
    for (const specifier of imports) {
      assert.ok(!specifier.startsWith('node:'), `${path} imports browser-incompatible ${specifier}`)
      if (specifier.startsWith('.')) await visit(resolve(dirname(path), specifier))
    }
  }
  await visit(entry)
  return visited
}

test('browser entry exports the CPU renderer, CSL, DSL, catalog, sinks, frame export, and canvas adapter', async () => {
  const api = await import(pathToFileURL(resolve(root, 'src/index.js')))
  for (const name of ['CslCompiler', 'compileCsl', 'Surface', 'parseDsl', 'EffectRegistry', 'createDefaultRegistry', 'CpuRenderer', 'CanvasSink', 'SinkManager', 'FrameExportQueue', 'renderToCanvas']) {
    assert.ok(name in api, `missing export ${name}`)
  }
})

test('browser public import graph contains no Node built-ins', async () => {
  const graph = await browserImportGraph(resolve(root, 'src/index.js'))
  assert.ok(graph.size >= 10)
})

test('renderToCanvas writes deterministic RGBA into a canvas-like host', async () => {
  const { renderToCanvas } = await import(pathToFileURL(resolve(root, 'src/index.js')))
  let presented = null
  const context = {
    createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) } },
    putImageData(image, x, y) { presented = { image, x, y } },
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  const result = renderToCanvas(canvas, 'search synth\nsolid(color: #f80).write(o0)\nrender(o0)', { width: 2, height: 1 })

  assert.equal(canvas.width, 2)
  assert.equal(canvas.height, 1)
  assert.deepEqual([...presented.image.data.slice(0, 4)], [255, 136, 0, 255])
  assert.equal(result.width, 2)
})
