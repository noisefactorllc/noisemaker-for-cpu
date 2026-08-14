import { createDefaultRegistry, kernelFactories, kernels } from '../effects/catalog.js'
import { CpuRenderer } from '../runtime/renderer.js'
import { CanvasSink } from '../runtime/sink.js'

function present(canvas, result) {
  const sink = new CanvasSink(canvas)
  sink.configure({
    width: result.width,
    height: result.height,
    format: 'rgba8unorm',
    colorSpace: 'srgb',
    alphaMode: 'straight',
    fps: 60,
  })
  sink.submit(result)
  sink.close()
}

export function renderToCanvas(canvas, source, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('canvas must provide getContext()')
  const width = options.width ?? canvas.width ?? 512
  const height = options.height ?? canvas.height ?? 512
  const renderer = options.renderer ?? new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: options.tileRows })
  const result = renderer.render(source, { ...options, width, height })
  present(canvas, result)
  return result
}

export async function renderToCanvasAsync(canvas, source, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('canvas must provide getContext()')
  const width = options.width ?? canvas.width ?? 512
  const height = options.height ?? canvas.height ?? 512
  const renderer = options.renderer ?? new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: options.tileRows })
  const result = await renderer.renderAsync(source, { ...options, width, height })
  present(canvas, result)
  return result
}
