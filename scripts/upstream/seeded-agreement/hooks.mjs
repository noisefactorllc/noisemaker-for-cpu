// A module loader hook for record.mjs: it wraps upstream's drawU32 so that
// every draw a compile makes is logged with its seed and key. It changes no
// value, and it is used only while recording the fixture.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (!url.endsWith('/shaders/src/lang/draws.js')) return result
  const source = String(result.source).replace(
    'export function drawU32(seed, key) {',
    'export function drawU32(seed, key) { const u = drawU32Unlogged(seed, key); globalThis.__seededDrawLog?.push({ seed, key, u }); return u }\nfunction drawU32Unlogged(seed, key) {',
  )
  if (source === String(result.source)) throw new Error('upstream drawU32 has changed shape; update hooks.mjs')
  return { ...result, source, shortCircuit: true }
}
