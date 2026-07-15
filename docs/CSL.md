# CPU Shader Language (CSL)

CSL is the CPU shader layer used by noisemaker-cpu. It has two intentionally compatible lanes:

1. Compact CSL is a small, typed GLSL-like language exposed through `compileCsl()` for trusted custom shaders.
2. Canonical GLSL compatibility translates the upstream Noisemaker fragment collection ahead of time into ESM factories with GPU-style float, uint, vector, matrix, texture, derivative, and pass-graph semantics.

Catalog rendering uses the second lane. It does not dynamically compile shader text and has no runtime dependency on `glsl-transpiler`.

## Compact CSL

A compact source file declares uniforms and functions and provides `vec4 main()`.

### Types

`void`, `bool`, `int`, `float`, `sampler2D`, `vec2`, `vec3`, and `vec4` are supported. Numeric vector operators broadcast scalars. Vector constructors accept one scalar (splat) or arguments containing the exact total component count.

```glsl
vec3 gray = vec3(0.5);
vec4 color = vec4(gray, 1.0);
color.bgr = color.rgb;
```

Swizzles use `xyzw`, `rgba`, or `stpq`. Vector indexing requires an integer.

### Declarations and functions

```glsl
const float TAU = 6.28318530718;
uniform sampler2D inputTex;
uniform float amount = 0.5;

float pulse(float value) {
  return sin(value * TAU) * 0.5 + 0.5;
}
```

Uniform defaults are used when the host omits a value. Function arguments use value semantics.

### Statements

Blocks, local declarations, assignments, `if`/`else`, `for`, `break`, `continue`, and `return` are implemented. Every fragment invocation shares a configurable loop-iteration guard; the default is 4096 iterations.

```glsl
float total = 0.0;
for (int index = 0; index < 8; index++) {
  total += 0.125;
}
```

### Fragment globals

- `uv`: normalized bottom-left coordinate at the pixel center
- `fragCoord`: bottom-left pixel coordinate at the pixel center
- `resolution`: output width and height
- `time`: host-provided normalized time
- `seed`: host-provided numeric seed

Catalog effects that declare a `seed` uniform inherit the render-level seed when the DSL omits that parameter. An explicit DSL value such as `noise(seed: 12)` takes precedence.

### Built-ins

Component-wise numeric functions include `abs`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `floor`, `ceil`, `round`, `fract`, `sqrt`, `exp`, `log`, `min`, `max`, `mod`, `pow`, `clamp`, `mix`, `step`, and `smoothstep`.

Vector functions include `length`, `distance`, `dot`, and `normalize`.

Texture functions:

```glsl
vec4 color = texture(inputTex, uv);
vec2 size = textureSize(inputTex);
```

Compact sampler inputs are linear RGBA float surfaces with clamp-to-edge behavior. The runtime converts bottom-left shader coordinates to top-down surface storage.

### Compilation and trust

`compileCsl(source, options)` parses and type-checks the complete source before generating a specialized JavaScript kernel. Identifiers, member access, and calls are whitelist-bound; CSL cannot name arbitrary JavaScript globals. Runtime compilation still uses the JavaScript `Function` constructor, so it is intended for trusted source.

## Canonical GLSL compatibility

`npm run compile:upstream` reads the pinned upstream snapshot and emits `src/effects/generated/canonical-kernels.js` plus a coverage manifest. This lane supports the constructs required by the eligible collection, including:

- GLSL float32 register boundaries and lowered float literals
- signed integer and overflowing uint32 arithmetic, PCG, and bit reinterpretation
- scalar/vector overloads, swizzles, matrices, arrays, and compile-time defines
- `texture`, `textureLod`, `textureSize`, `texelFetch`, and canonical filtering/origin rules
- `dFdx`, `dFdy`, and `fwidth` through deterministic 2×2 quad replay
- multi-pass render graphs, named attachments, external textures, and half-float attachment truncation

Of 212 canonical fragment programs, 208 are generated and 4 use full CPU adapters where an explicit implementation is clearer or faster. Additional narrowly scoped scalar adapters may replace a generated factory at dispatch time while retaining the generated kernel as a fallback.

Generated catalog modules are ordinary ESM and work under strict Content Security Policy. `glsl-transpiler` is a development-only dependency.

## Coordinates and sampling

Both lanes expose canonical GLSL bottom-left coordinates. Surface arrays, Canvas `ImageData`, and PNG files are top-down. The pass runner flips row addressing without changing shader-space coordinates, avoiding off-by-one errors at texel boundaries.

Canonical intermediate textures use their declared filtering behavior; nearest is the default. External image textures are marked linear. Sampling clamps to edges.

## Compact-language limits

The compact frontend does not itself parse the entire canonical dialect: structs, general arrays and matrices, preprocessor directives, overload sets, derivatives, explicit LOD operations, unsigned vectors, and multi-render-target declarations are handled by the AOT compatibility lane instead. These are language-lane limits, not effect-coverage exclusions.
