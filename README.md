# noisemaker-cpu

This is not the classic JS Noisemaker (Composer) library. This is a new
effort centered around software shader execution.

A CPU-only backport of the Noisemaker shader engine, Polymorphic DSL, and standalone-frame canonical 2D shader collection. It renders in vanilla JavaScript in browsers or Node.js without WebGL, WebGPU, native addons, or runtime package dependencies.

The renderer is designed to reproduce a frame anywhere JavaScript runs, with the expectation that complex frames can be slow. CSL—CPU Shader Language—provides a compact GLSL-like language for custom CPU shaders. The upstream Noisemaker GLSL collection is translated ahead of time into ordinary ESM pixel kernels, so catalog rendering needs neither runtime evaluation nor the GLSL transpiler.

## Quick start

Node.js 22 or newer is required for the CLI.

```bash
node bin/noisemaker-cpu.js effect noise \
  --width 256 --height 256 \
  --param scaleX=18 --param scaleY=12 \
  --output noise.png

printf 'search synth, filter\nnoise(scaleX: 18, scaleY: 12).posterize(levels: 8).write(o0)\nrender(o0)\n' |
  node bin/noisemaker-cpu.js render - \
    --width 256 --height 256 --seed 11 \
    --output showcase.png
```

Use an input image or named texture:

```bash
node bin/noisemaker-cpu.js effect filter/texture \
  --input source.png --output texture.png

node bin/noisemaker-cpu.js render program.dsl \
  --texture imageTex=source.png \
  --texture textTex=mask.png \
  --output result.png
```

Custom CSL uniforms are type-checked from their declarations; use `--uniform color=[1,0.5,0]`, `--uniform enabled=true`, and `--texture inputTex=source.png` for samplers.

Render from standard input:

```bash
printf 'search synth\nsolid(color: #f80).write(o0)\nrender(o0)\n' |
  node bin/noisemaker-cpu.js render - --width 128 --height 128 --output solid.png
```

`node bin/noisemaker-cpu.js effects` lists the complete catalog. `npm test` verifies the engine, `npm run compile:upstream` deterministically rebuilds the canonical kernels, `npm run parity` compares all default frames with GPU goldens, and `npm run bench -- --size 128` measures local throughput.

## Browser API

The main entry has no Node imports:

```js
import {
  CpuRenderer,
  createDefaultRegistry,
  kernelFactories,
  kernels,
} from './src/index.js'

const renderer = new CpuRenderer({
  registry: createDefaultRegistry(),
  kernels,
  kernelFactories,
})

const result = renderer.render(`
  search synth, filter
  noise(scaleX: 18, scaleY: 12)
    .posterize(levels: 8)
    .write(o0)
  render(o0)
`, { width: 256, height: 256, time: 0.25, seed: 11 })

const bytes = result.toRgba8()
```

The render-level integer `seed` supplies omitted effect seed parameters; a seed written explicitly in the DSL takes precedence. External browser images can be converted to a `Surface` and passed through `externalTextures`.

Initialized fibers, scratches, and stray-hair overlays use a 64 MiB LRU cache by default. Set `cpuTextureCacheByteLimit` in the `CpuRenderer` constructor, inspect `cpuTextureCacheStats()`, or release retained overlays with `clearCpuTextureCache()`/`dispose()`.

For a canvas, call `renderToCanvas(canvas, dsl, options)` or `await renderToCanvasAsync(...)`. The asynchronous form yields between scanline tiles so the page can update while the CPU works. A browser demo is in `examples/browser`: build a Polymorphic-DSL effect pipeline from the full effect catalog and watch it render on the CPU. Serve the repository over HTTP (for example `python3 -m http.server`) and open `examples/browser/index.html`.

## CSL

Custom CPU shaders use GLSL-like syntax and return one `vec4`:

```glsl
uniform vec3 color = vec3(1.0, 0.5, 0.0);
uniform float bands = 8.0;

vec4 main() {
  float value = sin(uv.y * bands * 6.2831853 + time) * 0.5 + 0.5;
  return vec4(color * value, 1.0);
}
```

```js
import { compileCsl } from './src/index.js'

const shader = compileCsl(source, { sourceName: 'bands.csl' })
```

Runtime compact-CSL compilation uses `Function` after parsing and whitelist-based type checking, so compile only shader source you trust. Catalog kernels use the separate canonical-GLSL compatibility lane and ship as generated ESM suitable for a strict Content Security Policy. See [docs/CSL.md](docs/CSL.md).

## Polymorphic DSL

```text
search synth, filter, mixer
let tuned = noise(scaleX: 15, scaleY: 9)
tuned(seed: 3).posterize(levels: 7).write(o0)
solid(color: #24f).write(o1)
read(o0).blendMode(tex: o1, mode: screen).write(o2)
render(o2)
```

The frontend preserves the canonical effect schemas, aliases, defaults, compile-time choices, pass graphs, named surfaces, generators, filters, and mixers. It supports explicit search order, positional or named arguments, value/effect partial bindings, `read(oN)`, chainable `.write(oN)`, and `render(oN)`. Stateful and particle operations compile and render like any other effect (see "CPU iteration divergence" in [docs/EFFECTS.md](docs/EFFECTS.md)); only reactive, 3D, and render-loop operations are rejected with diagnostics. `render` doubles as both the `render(oN)` directive keyword and the namespace owning `pointsEmit`/`pointsRender`/`pointsBillboardRender` — `search ..., render` resolves the namespace without disturbing the directive.

One-shot CPU overlays default to `oneShot: 'ready'`, which returns their initialized overlay on the first requested frame. Pass `oneShot: 'initial'` to reproduce the upstream pre-initialization first frame used by the parity fixtures.

## Collection parity

The catalog is the exact eligible collection from Noisemaker revision `a024dc3a960cc44af454abc7aebce50456c194e6`:

- 188 effects: 18 `classicNoisedeck`, 116 `filter`, 15 `mixer`, 10 `points`, 3 `render`, and 26 `synth`
- 274 canonical fragment programs: 265 generated from canonical GLSL, plus 9 full CPU adapters (4 fragment-kernel replacements and 5 vertex+fragment scatter-pass pairs, not plain fragment programs — see [docs/CSL.md](docs/CSL.md))
- all 410 compile-time shader choices execute through the CPU backend
- all 188 default programs render finite output

Only the requested classes are excluded: the explicitly removed reactive effects `synth/roll`, `synth/scope`, and `synth/spectrum`, 3D/mesh/cubemap effects, and render-loop control nodes. `filter/text` and `synth/media` are included through external `Surface`/PNG inputs. [docs/EFFECTS.md](docs/EFFECTS.md) contains the full inventory and exclusions.

Parity claims are enforced, not inferred. `npm run parity` compares every eligible default at 8×8, time `0.25`, seed `1`, and `oneShot: 'initial'` against GPU PNG goldens. The fixtures make each canonical effect seed default explicit so the render-level seed API cannot silently change the reference frame. The current strict result is 166/167 within ±2 RGBA bytes, with 117 byte-exact, plus 21 skipped. `filter/crt` remains red because JavaScript and ANGLE/Metal fast-math still diverge in its hash-sensitive pipeline. The gate remains failing until CRT matches. The 21 skipped are the CPU-only stateful/particle effects, which re-run their pass graph `iterationCount` times per frame on a schedule with no single-GPU-frame equivalent, so they are reported (`SKIP <id> (cpu-divergent, no GPU golden)`) rather than compared; see "CPU iteration divergence" in [docs/EFFECTS.md](docs/EFFECTS.md). The tolerance and the 167-effect pixel-parity denominator are unchanged; skips never affect the pass/fail count or exit code.

## Performance model

- Canonical GLSL is parsed/transpiled only during `npm run compile:upstream`.
- Built-ins are ahead-of-time generated ESM with cached factory binding.
- Scalar adapters cover hot or precision-sensitive paths without per-pixel allocations.
- Float surfaces, pass temporaries, vector registers, and texture-format conversion tables are reused.
- Signed/unsigned integer registers and PCG outputs are pooled per pixel; generated constructors use fixed arity in hot paths.
- Render graphs hoist bindings and traverse top-down storage in cache-friendly scanline tiles.
- The async renderer yields only at tile boundaries and does not change output bytes.
- Iterated (stateful/particle) effects re-run their entire pass graph `iterationCount` times per rendered frame, so cost scales with `iterationCount × passes`; `synth/navierStokes` is the worst case in the catalog. See "CPU iteration divergence" in [docs/EFFECTS.md](docs/EFFECTS.md) for concrete timings.

The renderer is CPU-bound by design. `npm run bench -- --size 128` reports local MP/s for a fill, sampled filter, blur, and representative chain. Throughput varies substantially by JavaScript engine and effect complexity.

## Coordinates and color

Shader coordinates follow GLSL: `uv=(0,0)` is bottom-left and pixel centers are `(x+0.5,y+0.5)`. Surfaces remain top-down for Canvas, PNG, and `ImageData`; sampling performs the origin conversion at the boundary. Canonical internal texture sampling is nearest unless a source is explicitly linear; external image inputs use linear sampling. Pass attachment formats, including half-float truncation, follow the canonical graph. PNG/Canvas conversion clamps to `[0,1]`, maps non-finite values to zero, and rounds to straight 8-bit RGBA.

## License

MIT. See [LICENSE](LICENSE) and [TRADEMARK.md](TRADEMARK.md).
