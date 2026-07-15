import { createDefaultRegistry, kernelFactories, kernels } from '../effects/catalog.js'
import { CpuRenderer } from '../runtime/renderer.js'

export function renderToCanvas(canvas, source, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('canvas must provide getContext()')
  const width = options.width ?? canvas.width ?? 512
  const height = options.height ?? canvas.height ?? 512
  const renderer = options.renderer ?? new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: options.tileRows })
  const result = renderer.render(source, { ...options, width, height })
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  const image = context.createImageData(width, height)
  image.data.set(result.toRgba8())
  context.putImageData(image, 0, 0)
  return result
}

export async function renderToCanvasAsync(canvas, source, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('canvas must provide getContext()')
  const width = options.width ?? canvas.width ?? 512
  const height = options.height ?? canvas.height ?? 512
  const renderer = options.renderer ?? new CpuRenderer({ registry: createDefaultRegistry(), kernels, kernelFactories, tileRows: options.tileRows })
  const result = await renderer.renderAsync(source, { ...options, width, height })
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context is unavailable')
  const image = context.createImageData(width, height)
  image.data.set(result.toRgba8())
  context.putImageData(image, 0, 0)
  return result
}
