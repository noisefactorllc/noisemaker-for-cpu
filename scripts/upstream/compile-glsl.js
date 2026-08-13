#!/usr/bin/env node

import GLSL from 'glsl-transpiler'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeCanonicalGlsl } from '../../src/csl/glsl-normalize.js'
import { GLSL_STDLIB_NAMES } from '../../src/csl/glsl-kernel.js'
import { UPSTREAM_REVISION, effectRecords } from '../../src/effects/generated/upstream-snapshot.js'
import { PINNED_UPSTREAM_REVISION, assertPinnedSource } from './source-lock.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const referenceRoot = resolve(process.env.NM_REFERENCE_ROOT ?? resolve(projectRoot, '..', 'noisemaker'))
const effectsRoot = resolve(referenceRoot, 'shaders', 'effects')
const outputPath = resolve(projectRoot, 'src', 'effects', 'generated', 'glsl-coverage.js')
const kernelsPath = resolve(projectRoot, 'src', 'effects', 'generated', 'canonical-kernels.js')
const adapterDataPath = resolve(projectRoot, 'src', 'effects', 'generated', 'canonical-adapter-data.js')
// Keyed by `${effectId}:${program}` (program = GLSL filename minus extension) so a single
// program within a multi-program effect can be routed to a hand/CPU-side adapter without
// pulling its sibling programs (e.g. points/dla's agent/copyGrid/initGrid/passthrough) out of
// the transpiled path. The five scatter/vertex-paired programs below are `.frag` halves of a
// `.vert`+`.frag` gl.POINTS draw (vertex-stage scatter) — compile-glsl.js only ever reads
// `.glsl`/`.frag` files (never `.vert`), so without this explicit skip their `.frag` half would
// still be picked up and (incorrectly) sent through the fragment-kernel transpiler. These five
// dispatch through the renderer's separate scatter-adapter mechanism at render time (`drawMode:
// 'points'/'billboards'`, resolved via src/effects/cpu/scatter-registry.js), never through
// canonicalKernelFactories/canonicalAdapterFactories: their real implementations are hand-written
// CPU scatter adapters in src/effects/cpu/points-deposit.js and billboard-deposit.js, registered
// under these same keys in scatter-registry.js. Skipping them here (excluding them from
// transpilation) is what lets them carry `status: 'adapter'` in glsl-coverage.js rather than a
// missing-coverage gap.
const adapters = new Set([
  'classicNoisedeck/fractal:fractal',
  'filter/historicPalette:historicPalette',
  'filter/palette:palette',
  'filter3d/flow3d:deposit',
  'synth/julia:julia',
  'points/dla:depositGrid',
  'points/lenia:deposit',
  'points/physarum:deposit',
  'render/pointsRender:deposit',
  'render/pointsBillboardRender:deposit',
])

assertPinnedSource(referenceRoot)
if (UPSTREAM_REVISION !== PINNED_UPSTREAM_REVISION) {
  throw new Error(`Generated effect snapshot revision mismatch: expected ${PINNED_UPSTREAM_REVISION}, received ${UPSTREAM_REVISION}`)
}

function runtimeDefines(record) {
  return Object.fromEntries(Object.values(record.params).filter((param) => param.define).map((param) => [
    param.define,
    param.type === 'float' ? 'float' : 'int',
  ]))
}

function parseVectorList(body, type, width) {
  const values = []
  const expression = new RegExp(`${type}\\s*\\(([^)]+)\\)`, 'g')
  for (const match of body.matchAll(expression)) {
    const vector = match[1].split(',').map((value) => Number(value.trim()))
    if (vector.length !== width || vector.some((value) => !Number.isFinite(value))) {
      throw new Error(`Unable to parse canonical ${type} value ${match[0]}`)
    }
    values.push(...vector)
  }
  return values
}

function parsePaletteEntries(source) {
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const entries = []
  const entry = /\bPaletteEntry\s*\(\s*(vec4\([^)]*\)\s*,\s*vec4\([^)]*\)\s*,\s*vec4\([^)]*\)\s*,\s*vec4\([^)]*\))\s*\)/g
  for (const match of source.matchAll(entry)) entries.push(parseVectorList(match[1], 'vec4', 4))
  if (entries.length !== 55) throw new Error(`Expected 55 canonical cosine palettes, found ${entries.length}`)
  return entries
}

function parseHistoricPaletteEntries(source) {
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const entries = []
  const entry = /\bHistoricPalette\s*\(\s*(vec3\([^)]*\)\s*,\s*vec3\([^)]*\)\s*,\s*vec3\([^)]*\)\s*,\s*vec3\([^)]*\)\s*,\s*vec3\([^)]*\))\s*\)/g
  for (const match of source.matchAll(entry)) entries.push(parseVectorList(match[1], 'vec3', 3))
  if (entries.length !== 21) throw new Error(`Expected 21 canonical historic palettes, found ${entries.length}`)
  return entries
}

function transpile(source) {
  const preprocess = source.split('\n').some((line) => /^\s*#/.test(line))
  const compile = GLSL({
    version: '300 es',
    preprocess,
    optimize: true,
    includes: false,
    uniform: (name) => `$bindings[${JSON.stringify(name)}]`,
    varying: (name) => `$varyings[${JSON.stringify(name)}]`,
  })
  return compile(source)
}

function lowerUnsignedJavaScript(transpiled, originalSource) {
  let lowered = transpiled.replace(
    /function (cpu_uvec([234])(?:_[A-Za-z0-9_]+)?) \([^)]*\) \{[\s\S]*?\n\};/g,
    (_, name, width) => {
      const params = ['a', 'b', 'c', 'd'].slice(0, Number(width)).join(', ')
      return `function ${name} (${params}) { return $runtime.stdlib.uvec${width}(${params}); };`
    },
  )
  lowered = lowered.replace(
    /function cpu_umul \([^)]*\) \{[\s\S]*?\n\};/,
    'function cpu_umul (left, right) { return $runtime.stdlib.umul(left, right); };',
  )
  lowered = lowered.replace(
    /function cpu_float \([^)]*\) \{[\s\S]*?\n\};/,
    'function cpu_float (value) { return $runtime.stdlib.float(value); };',
  )
  lowered = lowered.replace(
    /function (cpu_ivec([234])(?:_[A-Za-z0-9_]+)?) \([^)]*\) \{[\s\S]*?\n\};/g,
    (_, name, width) => {
      const params = ['a', 'b', 'c', 'd'].slice(0, Number(width)).join(', ')
      return `function ${name} (${params}) { return $runtime.stdlib.ivec${width}(${params}); };`
    },
  )
  const pcgFunctions = [...originalSource.matchAll(/\buvec3\s+(pcg|pcg3|pcg3d)\s*\(\s*uvec3\b/g)].map((match) => match[1])
  for (const name of new Set(pcgFunctions)) {
    lowered = lowered.replace(
      new RegExp(`function ${name} \\([^)]*\\) \\{[\\s\\S]*?\\n\\};`),
      `function ${name} (value) { return $runtime.stdlib.pcg3d(value); };`,
    )
  }
  if (/\buint\s+hash_uint\s*\(\s*uint\b/.test(originalSource)) {
    lowered = lowered.replace(
      /function hash_uint \([^)]*\) \{[\s\S]*?\n\};/,
      'function hash_uint (value) { return $runtime.stdlib.hashUint(value); };',
    )
  }
  lowered = lowered
    .replace(/var denom = 4294967295\.0;/g, 'var denom = cpu_float(4294967295.0);')
    .replace(/return _ \/ 4294967295\.0;/g, 'return cpu_float(cpu_float(_) / cpu_float(4294967295.0));')
    .replace(/\(([A-Za-z_$]\w*)\[(\d+)\]\) \/ denom/g, 'cpu_float(cpu_float($1[$2]) / denom)')
    .replace(/\(([A-Za-z_$]\w*)\[(\d+)\]\) \/ 4294967295\.0/g, 'cpu_float(cpu_float($1[$2]) / cpu_float(4294967295.0))')
  if (/\bcpu_float\s*\(/.test(lowered) && !/function cpu_float\s*\(/.test(lowered)) {
    lowered = `function cpu_float (value) { return $runtime.stdlib.float(value); };\n${lowered}`
  }
  return lowered
}

function lowerFloatLiterals(transpiled) {
  // JavaScript parses numeric literals as float64. GLSL highp decimal and
  // exponential literals are float32 values before they participate in an
  // operation. Emit the exact float32 value at build time so hot kernels keep
  // native arithmetic and do not need a Math.fround call for every constant.
  return transpiled.replace(
    /(?<![A-Za-z0-9_$.])(?:\d+\.\d*|\.\d+|\d+(?:\.\d*)?[eE][+-]?\d+)(?![A-Za-z0-9_$.])/g,
    (literal) => String(Math.fround(Number(literal))),
  )
}

function preserveIntCastPrecedence(transpiled) {
  const operatorAfterCast = /^(?:\s*)(?:[+\-*/%^]|<<|>>)/
  let output = transpiled
  for (let cast = output.indexOf('|0'); cast !== -1; cast = output.indexOf('|0', cast + 3)) {
    if (!operatorAfterCast.test(output.slice(cast + 2))) continue
    let start = cast - 1
    while (start >= 0 && /\s/.test(output[start])) start -= 1
    if (output[start] === ')' || output[start] === ']') {
      const close = output[start]
      const open = close === ')' ? '(' : '['
      let depth = 1
      start -= 1
      while (start >= 0 && depth > 0) {
        if (output[start] === close) depth += 1
        else if (output[start] === open) depth -= 1
        start -= 1
      }
      while (start >= 0 && /[A-Za-z0-9_$\.]/.test(output[start])) start -= 1
      start += 1
    } else {
      while (start >= 0 && /[A-Za-z0-9_$\.]/.test(output[start])) start -= 1
      start += 1
    }
    output = `${output.slice(0, start)}(${output.slice(start, cast + 2)})${output.slice(cast + 2)}`
    cast += 2
  }
  return output
}

function poolLocalVectors(transpiled) {
  let depth = 0
  return transpiled.split('\n').map((line) => {
    let pooled = line
    if (depth > 0) {
      pooled = pooled
        .replace(/new Float32Array/g, 'new $runtime.PooledFloat32Array')
        .replace(/([A-Za-z_$]\w*) = \1\.slice\(\);/g, '$1 = $runtime.copy($1);')
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    return pooled
  }).join('\n')
}

function preserveMedianUnsignedSemantics(transpiled) {
  // These helpers only read their uvec2 arguments. The transpiler's default
  // vec2 parameter copies would coerce the normalized unsigned arrays through
  // Float32Array and round their packed 32-bit ordering keys.
  const patterns = [
    /(function lessRecord \([^)]*\) \{\s*)a = a\.slice\(\);\s*b = b\.slice\(\);/,
    /(function unpackRecordRgb \([^)]*\) \{\s*)major = major\.slice\(\);/,
  ]
  let output = transpiled
  for (const pattern of patterns) {
    if (!pattern.test(output)) throw new Error('Unable to preserve median unsigned parameter values')
    output = output.replace(pattern, '$1')
  }
  // Both 16-bit half-word rotations operate on GLSL uint values. JavaScript's
  // arithmetic right shift sign-extends packed words whose high bit is set.
  for (const helper of ['packRecordMajor', 'unpackRecordRgb']) {
    const pattern = new RegExp(`function ${helper} \\([^)]*\\) \\{[\\s\\S]*?\\n\\};`)
    const match = output.match(pattern)
    if (!match) throw new Error(`Unable to find median ${helper} helper`)
    const shiftCount = [...match[0].matchAll(/ >> 16/g)].length
    if (shiftCount !== 1) throw new Error(`Expected one packed-word shift in median ${helper}, found ${shiftCount}`)
    output = output.replace(pattern, match[0].replace(' >> 16', ' >>> 16'))
  }
  return output
}

function preserveVectorAssignmentReads(source) {
  let assignmentIndex = 0
  return source.replace(
    /^(\s*)([A-Za-z_]\w*)\s*=\s*((?:[biu]?vec[234])\s*\([^;\n]*\)[^;\n]*)\s*;$/gm,
    (statement, indent, target, expression) => {
      if (!new RegExp(`\\b${target}\\.[xyzwrgba]`).test(expression)) return statement
      const type = expression.match(/^([biu]?vec[234])\s*\(/)?.[1]
      if (!type) return statement
      const temporary = `cpu_vector_assignment_${assignmentIndex++}`
      return `${indent}${type} ${temporary} = ${expression};\n${indent}${target} = ${temporary};`
    },
  )
}

function preserveMatrixSelfAssignments(source) {
  let assignmentIndex = 0
  return source.replace(
    /^(\s*)([A-Za-z_]\w*)\s*=\s*(mat([234])\s*\([^;\n]*\)\s*\*\s*\2)\s*;$/gm,
    (_, indent, target, expression, width) => {
      const temporary = `cpu_matrix_assignment_${assignmentIndex++}`
      return `${indent}vec${width} ${temporary} = ${expression};\n${indent}${target} = ${temporary};`
    },
  )
}

function preserveTextureScalarSwizzles(source) {
  const components = { r: 0, g: 1, b: 2, a: 3 }
  const used = new Set()
  const call = /\b(texture|texelFetch)\s*\(/g
  let cursor = 0
  let output = ''
  for (let match = call.exec(source); match; match = call.exec(source)) {
    const open = source.indexOf('(', match.index)
    let depth = 1
    let close = open + 1
    while (close < source.length && depth > 0) {
      if (source[close] === '(') depth += 1
      else if (source[close] === ')') depth -= 1
      close += 1
    }
    if (depth !== 0) throw new Error(`Unbalanced ${match[1]} call while preserving scalar swizzle`)
    const suffix = source.slice(close).match(/^\s*\.([rgba])\b/)
    if (!suffix) continue
    const helper = `cpu_${match[1]}_${suffix[1]}`
    used.add(`${match[1]}:${suffix[1]}`)
    output += source.slice(cursor, match.index) + helper + source.slice(open, close)
    cursor = close + suffix[0].length
    call.lastIndex = cursor
  }
  if (used.size === 0) return source
  output += source.slice(cursor)
  const helpers = [...used].map((entry) => {
    const [name, component] = entry.split(':')
    const index = components[component]
    if (name === 'texture') {
      return `float cpu_texture_${component}(sampler2D samplerValue, vec2 coordValue) { vec4 cpuSample = texture(samplerValue, coordValue); return cpuSample[${index}]; }`
    }
    return `float cpu_texelFetch_${component}(sampler2D samplerValue, ivec2 coordValue, int lodValue) { vec4 cpuSample = texelFetch(samplerValue, coordValue, lodValue); return cpuSample[${index}]; }`
  }).join('\n')
  return `${helpers}\n${output}`
}

function preserveFloatCasts(source) {
  if (!/\bfloat\s*\(/.test(source)) return source
  return `float cpu_float(float value) { return value; }\n${source.replace(/\bfloat\s*\(/g, 'cpu_float(')}`
}

function preserveScalarFloatDeclarations(source) {
  // A GLSL scalar declaration writes a float32 register. glsl-transpiler
  // otherwise leaves that local in a JavaScript float64, which is observably
  // wrong before fract/floor at large magnitudes.
  return source.replace(
    /^(\s*)((?:const\s+)?float\s+[A-Za-z_]\w*\s*=\s*)([^;\n]+);$/gm,
    (_, indent, declaration, expression) => `${indent}${declaration}float(${expression});`,
  )
}

function lowerPaletteStructArray(source) {
  const declaration = source.match(
    /const PaletteEntry PALETTES\[PALETTE_COUNT\] = PaletteEntry\[PALETTE_COUNT\]\(([\s\S]*?)\n\);/,
  )
  if (!declaration) throw new Error('Unable to locate canonical palette3d struct array')
  const entries = [...declaration[1].matchAll(
    /PaletteEntry\(\s*(vec4\([^)]*\))\s*,\s*(vec4\([^)]*\))\s*,\s*(vec4\([^)]*\))\s*,\s*(vec4\([^)]*\))\s*\)/g,
  )]
  if (entries.length !== 55) throw new Error(`Expected 55 canonical palette3d entries, found ${entries.length}`)
  const selectorNames = ['cpuPaletteAmp', 'cpuPaletteFreq', 'cpuPaletteOffset', 'cpuPalettePhase']
  const selectors = selectorNames.map((name, fieldIndex) =>
    `vec4 ${name}(int index) {\n` +
    entries.slice(0, -1).map((entry, index) => `    if (index == ${index}) return ${entry[fieldIndex + 1]};`).join('\n') +
    `\n    return ${entries.at(-1)[fieldIndex + 1]};\n}`,
  ).join('\n')
  return source
    .replace(/struct PaletteEntry \{[\s\S]*?\n\};\n/, '')
    .replace(declaration[0], selectors)
    .replace(
      'PaletteEntry entry = PALETTES[paletteIndex - 1];',
      'int cpuPaletteIndex = paletteIndex - 1;\n' +
      '    vec4 entryAmp = cpuPaletteAmp(cpuPaletteIndex);\n' +
      '    vec4 entryFreq = cpuPaletteFreq(cpuPaletteIndex);\n' +
      '    vec4 entryOffset = cpuPaletteOffset(cpuPaletteIndex);\n' +
      '    vec4 entryPhase = cpuPalettePhase(cpuPaletteIndex);',
    )
    .replaceAll('entry.amp', 'entryAmp')
    .replaceAll('entry.freq', 'entryFreq')
    .replaceAll('entry.offset', 'entryOffset')
    .replaceAll('entry.phase', 'entryPhase')
}

function adaptCanonicalSource(effectId, source) {
  // glsl-transpiler flattens these common hash swizzles into scalar JS inside
  // one typed-array constructor, erasing the float32 operation boundaries
  // between the add and multiply. Explicit float casts retain the GLSL hash
  // result while still compiling to allocation-free Math.fround calls.
  if (effectId !== 'filter/scatter') {
    source = source
      .replaceAll(
        'if (hit.dist > 0.0) {',
        'float cpuVoxelHitDist = hit.dist;\n        if (cpuVoxelHitDist > 0.0) {',
      )
      .replaceAll(
        'return fract((p3.x + p3.y) * p3.z);',
        'return fract(float(float(p3.x + p3.y) * p3.z));',
      )
      .replaceAll(
        'return fract((p3.xx + p3.yz) * p3.zy);',
        'return fract(vec2(float(float(p3.x + p3.y) * p3.z), float(float(p3.x + p3.z) * p3.y)));',
      )
  }
  source = source.replace(
    /^(\s*)i1 = \(x0\.x > x0\.y\) \? vec2\(1\.0, 0\.0\) : vec2\(0\.0, 1\.0\);$/gm,
    '$1if (x0.x > x0.y) { i1 = vec2(1.0, 0.0); } else { i1 = vec2(0.0, 1.0); }',
  )
  if (effectId === 'filter/median') {
    // Canonical normalization represents uvec2 declarations as vec2 plus
    // unsigned constructor helpers. Initialize the fixed record array through
    // that helper so packed uint keys do not get rounded by Float32Array.
    const majorRecordInitializer = Array.from({ length: 49 }, () => 'cpu_uvec2(0.0)').join(', ')
    source = source
      .replace(
        'vec2 majorRecords[49];',
        `vec2 majorRecords[49] = vec2[49](${majorRecordInitializer});`,
      )
      .replace(
        /float b = unpackHalf2x16\(blue\)\.x;/,
        'vec2 unpackedBlue = unpackHalf2x16(blue);\n    float b = unpackedBlue.x;',
      )
      .replace(
        /int medianIndex = 49 \/ 2;\s*int left = 0;\s*int right = 49 - 1;/,
        'int activeCount = (RADIUS * 2 + 1) * (RADIUS * 2 + 1);\n    int medianIndex = (activeCount - 1) >> 1;\n    int left = 0;\n    int right = activeCount - 1;',
      )
      .replace(
        'vec2 pivotMajor = majorRecords[medianIndex];',
        'vec2 pivotMajor = cpu_uvec2(majorRecords[medianIndex].x, majorRecords[medianIndex].y);',
      )
      .replace(
        'vec2 temporaryMajor = majorRecords[scanLeft];',
        'vec2 temporaryMajor = cpu_uvec2(majorRecords[scanLeft].x, majorRecords[scanLeft].y);',
      )
  }
  if (effectId === 'filter/outline') {
    source = source.replace(
      /samples\[idx\] = texelFetch\(valueTexture, ivec2\(sampleX, sampleY\), 0\)\.r;/,
      'vec4 sampleValue = texelFetch(valueTexture, ivec2(sampleX, sampleY), 0);\n            samples[idx] = sampleValue.r;',
    )
  }
  if (effectId === 'synth/curl') {
    source = source.replace(
      /curl = tanh\(curl \* intensity\) \* 0\.5 \+ 0\.5;/,
      'curl = vec3(tanh(curl.x * intensity) * 0.5 + 0.5, tanh(curl.y * intensity) * 0.5 + 0.5, tanh(curl.z * intensity) * 0.5 + 0.5);',
    )
  }
  if (effectId === 'synth/remap') {
    source = source.replace('getZonePack(zoneIdx, vertIdx / 2)', 'getZonePack(zoneIdx, vertIdx >> 1)')
  }
  if (effectId === 'filter/smooth') {
    source = source.replace(
      'sum += texelFetch(inputTex, clamp(coord + cpu_ivec2(dx, dy), cpu_ivec2(0), maxC), 0) * w;',
      'vec4 weightedSample = texelFetch(inputTex, clamp(coord + cpu_ivec2(dx, dy), cpu_ivec2(0), maxC), 0);\n            sum += vec4(weightedSample.r * w, weightedSample.g * w, weightedSample.b * w, weightedSample.a * w);',
    )
  }
  if (effectId === 'synth/polygon') {
    source = source.replace(
      'float m = smoothstep(radius, radius - smoothing, d);',
      'float m = smoothing == 0.0 ? (d <= radius ? 1.0 : 0.0) : smoothstep(radius, radius - smoothing, d);',
    )
  }
  if (effectId === 'mixer/cellSplit') {
    source = source.replace(
      'if (cellId == nearestCell) continue;',
      'if (cellId.x == nearestCell.x && cellId.y == nearestCell.y) continue;',
    )
  }
  if (effectId === 'synth/newton') {
    source = source
      .replace('cHi = p.center.xy + vec2(centerHiX, centerHiY);', 'cHi = vec2(p.center.x, p.center.y) + vec2(centerHiX, centerHiY);')
      .replace('cLo = p.center.zw + vec2(centerLoX, centerLoY);', 'cLo = vec2(p.center.z, p.center.w) + vec2(centerLoX, centerLoY);')
  }
  if (effectId === 'classicNoisedeck/shapes3d') {
    // glsl-transpiler resolves `data.repeatSpacing` as the owning TransformData
    // struct when it participates directly in vector division. Copying the
    // scalar member to a local preserves the GLSL operation and its type.
    source = source.replaceAll(
      'p -= data.repeatSpacing * round(p / data.repeatSpacing);',
      'float cpuRepeatSpacing = data.repeatSpacing;\n        p -= cpuRepeatSpacing * round(p / cpuRepeatSpacing);',
    )
  }
  if (effectId === 'filter3d/palette3d') {
    // glsl-transpiler cannot lower a constant array of structs and silently
    // emits constant vec4 arrays as empty arrays. Selector functions retain
    // the same dynamic lookup and every canonical field value.
    source = lowerPaletteStructArray(source)
  }
  if (['render/render3d', 'render/renderCubemap3d', 'render/renderLit3d'].includes(effectId)) {
    // As with TransformData above, glsl-transpiler assigns the owning hit
    // struct's type to a scalar member used inside arithmetic. Typed locals
    // make the scalar boundary explicit without changing the raymarch.
    source = source
      .replaceAll(
        'result.dist = (tLo + tHi) * 0.5;\n            result.pos = ro + rd * result.dist;',
        'float cpuResultDist = (tLo + tHi) * 0.5;\n            result.dist = cpuResultDist;\n            result.pos = ro + rd * cpuResultDist;',
      )
      .replaceAll(
        'vec3 p = ro + rd * hit.dist;',
        'float cpuHitDist = hit.dist;\n            vec3 p = ro + rd * cpuHitDist;',
      )
      .replaceAll(
        'depth = hit.dist / MAX_DIST;',
        'float cpuHitDepth = hit.dist;\n            depth = cpuHitDepth / MAX_DIST;',
      )
  }
  if (effectId === 'synth/noise') {
    source = source
      .replace('float base = map(75.0, 1.0, 100.0, 40.0, 1.0);', 'float base = 10.84848403930664;')
      .replace('float base = map(75.0, 1.0, 100.0, 6.0, 0.5);', 'float base = 1.8888888359069824;')
      .replace('float base = map(75.0, 1.0, 100.0, 20.0, 3.0);', 'float base = 7.292929649353027;')
  }
  if (effectId === 'filter/pixelSort') {
    source = source.replace(
      'int sampleX = (s * width) / NUM_SAMPLES;',
      'int sampleX = int(floor(float(s * width) / float(NUM_SAMPLES)));',
    )
  }
  if (effectId === 'filter/dither') {
    // The pinned shader constants make FS_ERR_W exactly 18. glsl-transpiler
    // otherwise lowers this uninitialized fixed-size array to an empty JS array.
    const errorRowInitializer = Array.from({ length: 18 }, () => 'vec3(0.0)').join(', ')
    source = source
      .replace(
        'vec3 errRow[FS_ERR_W];',
        `vec3 errRow[18] = vec3[18](${errorRowInitializer});`,
      )
      .replace(
        'ivec2 blockOrigin = (cell / FS_BLOCK) * FS_BLOCK;',
        'ivec2 blockOrigin = ivec2(int(float(cell.x) / float(FS_BLOCK)) * FS_BLOCK, int(float(cell.y) / float(FS_BLOCK)) * FS_BLOCK);',
      )
      .replace('return bayer2x2[y & 1][x & 1];', 'return cpu_bayer2[(y & 1) * 2 + (x & 1)];')
      .replace('return bayer4x4[y & 3][x & 3];', 'return cpu_bayer4[(y & 3) * 4 + (x & 3)];')
    source = `const float cpu_bayer2[4] = float[4](0.0, 0.5, 0.75, 0.25);\n` +
      `const float cpu_bayer4[16] = float[16](0.0, 0.5, 0.125, 0.625, 0.75, 0.25, 0.875, 0.375, 0.1875, 0.6875, 0.0625, 0.5625, 0.9375, 0.4375, 0.8125, 0.3125);\n${source}`
  }
  if (effectId === 'filter/snow') {
    source = source
      .replace(
        'float z_base = cos(angle) * speed;',
        'float z_base = abs(cos(angle)) < 0.0000001 ? 0.0 : cos(angle) * speed;',
      )
      .replace(
        'float dot_val = dot(scaled, scaled.yzx + vec3(33.33));',
        'float dot_val = float(scaled.x * float(scaled.y + 33.33) + float(scaled.y * float(scaled.z + 33.33) + float(scaled.z * float(scaled.x + 33.33))));',
      )
    source = preserveScalarFloatDeclarations(source)
  }
  if (effectId === 'synth/reactionDiffusion') {
    // glsl-transpiler's `optimize: true` constant folder emits a literal `NaN` in place of the
    // `a2`/`b2` locals when they reach `fragColor = vec4(a2, b2, 0.0, 1.0);` in rdFb.glsl — a
    // transpiler bug reproduced in isolation (renaming the identifiers alone, with no other
    // change, makes the bogus fold disappear), most likely the optimizer's `vecN`/`matN`-suffix
    // detection misfiring on any bare `<letter><digit>` identifier. rd.glsl's unrelated bicubic
    // helper also declares a local `b2`; renaming it too is free insurance against the same
    // landmine. Renaming is a pure syntactic dodge — every read and write moves together.
    source = source.replace(/\ba2\b/g, 'aNext').replace(/\bb2\b/g, 'bNext')
  }
  if (effectId === 'synth3d/cell3d') {
    // The same optimizer bug described above for reactionDiffusion folds the
    // h1/h2/h3 color locals to NaN. Descriptive names avoid its type-suffix
    // heuristic while preserving every expression and use.
    source = source
      .replace(/\bh1\b/g, 'cellHueOne')
      .replace(/\bh2\b/g, 'cellHueTwo')
      .replace(/\bh3\b/g, 'cellHueThree')
  }
  if (effectId === 'synth3d/flythrough3d') {
    // FractalResult contains exactly three floats. Lower it to a vec3 because
    // glsl-transpiler treats scalar struct members as the whole struct in
    // comparisons/arithmetic and corrupts struct-member assignments.
    source = source
      .replace(/struct FractalResult \{[\s\S]*?\n\};\n/, '')
      .replace(/\bFractalResult\b/g, 'vec3')
      .replace(/\.dist\b/g, '.x')
      .replace(/\.trap\b/g, '.y')
      .replace(/\.iterRatio\b/g, '.z')
  }
  return preserveFloatCasts(preserveTextureScalarSwizzles(preserveVectorAssignmentReads(preserveMatrixSelfAssignments(source))))
}

function factorySource(index, effectId, transpiled, normalized, originalSource) {
  if (effectId === 'filter/median') transpiled = preserveMedianUnsignedSemantics(transpiled)
  transpiled = lowerUnsignedJavaScript(transpiled, originalSource)
  // ANGLE's optimized scatter hash straddles a nearest-sampling boundary in
  // the canonical default. Its original scalar lowering matches that backend;
  // strict literal lowering moves one texel to the opposite side.
  if (effectId !== 'filter/scatter') transpiled = lowerFloatLiterals(transpiled)
  transpiled = preserveIntCastPrecedence(transpiled)
  transpiled = poolLocalVectors(transpiled)
  const called = new Set([...transpiled.matchAll(/\b([A-Za-z_$]\w*)\s*\(/g)].map((match) => match[1]))
  const defined = new Set([...transpiled.matchAll(/function\s+([A-Za-z_$]\w*)\s*\(/g)].map((match) => match[1]))
  const stdlibNames = GLSL_STDLIB_NAMES.filter((name) =>
    !defined.has(name) && (
      called.has(name) ||
      new RegExp(`\\b${name}\\.`).test(transpiled) ||
      new RegExp(`\\.(?:map|forEach)\\(\\s*${name}\\s*\\)`).test(transpiled)
    ),
  )
  const varyingCopies = normalized.varyings.map(({ name }) => `  ${name}.set($runtime.varyings[${JSON.stringify(name)}])`).join('\n')
  // Location-ascending output names (MRT kernel contract, Global Constraints). A single-output
  // program's sole entry is always named "fragColor" in every canonical shader in this corpus,
  // so this path is byte-identical to the previous hardcoded `writeColor(fragColor, out)` emission.
  const outputNames = [...normalized.outputLocations].sort((left, right) => left.location - right.location).map((entry) => entry.name)
  const isMrt = outputNames.length > 1
  const writeOutputs = isMrt
    ? outputNames.map((name, outputIndex) => [0, 1, 2, 3]
      .map((component) => `    out[${outputIndex * 4 + component}] = ${name}[${component}]`)
      .join('\n')).join('\n') + '\n'
    : `    $runtime.writeColor(${outputNames[0] ?? 'fragColor'}, out)\n`
  return `function canonicalFactory${index}($bindings, $runtime) {\n` +
    (stdlibNames.length > 0 ? `  const { ${stdlibNames.join(', ')} } = $runtime.stdlib\n` : '') +
    `  const gl_FragCoord = $runtime.fragCoord\n` +
    transpiled.split('\n').map((line) => `  ${line}`).join('\n') + '\n' +
    `  return function canonicalKernel(context, out) {\n` +
    `    $runtime.beginPixel(context)\n` +
    (varyingCopies ? `${varyingCopies}\n` : '') +
    `    main()\n` +
    writeOutputs +
    `  }\n` +
    `}\n` +
    (/\b(?:dFdx|dFdy|fwidth)\s*\(/.test(originalSource) ? `canonicalFactory${index}.usesDerivatives = true\n` : '') +
    (isMrt ? `canonicalFactory${index}.outputNames = ${JSON.stringify(outputNames)}\n` : '')
}

if (!existsSync(effectsRoot)) throw new Error(`No Noisemaker effect tree at ${effectsRoot}; set NM_REFERENCE_ROOT`)

const coverage = []
const factories = []
let paletteData = null
let historicPaletteData = null
for (const record of effectRecords) {
  const glslDirectory = resolve(effectsRoot, record.id, 'glsl')
  if (!existsSync(glslDirectory)) throw new Error(`${record.id} has no canonical GLSL directory`)
  const files = (await readdir(glslDirectory)).filter((file) => ['.glsl', '.frag'].includes(extname(file))).sort()
  if (files.length === 0) throw new Error(`${record.id} has no canonical fragment program`)
  for (const file of files) {
    const program = file.slice(0, -extname(file).length)
    const sourceName = `${record.id}/glsl/${file}`
    const source = await readFile(resolve(glslDirectory, file), 'utf8')
    if (record.id === 'filter/palette') paletteData = parsePaletteEntries(source)
    if (record.id === 'filter/historicPalette') historicPaletteData = parseHistoricPaletteEntries(source)
    const rawNormalized = normalizeCanonicalGlsl(source, { sourceName, runtimeDefines: runtimeDefines(record) })
    const normalized = Object.freeze({ ...rawNormalized, source: adaptCanonicalSource(record.id, rawNormalized.source) })
    let generatedBytes = 0
    let transpiled = ''
    const status = adapters.has(`${record.id}:${program}`) ? 'adapter' : 'generated'
    if (status === 'generated') {
      try {
        transpiled = transpile(normalized.source)
        generatedBytes = Buffer.byteLength(transpiled)
      } catch (error) {
        throw new Error(`${sourceName} failed CPU transpilation: ${error.message}`, { cause: error })
      }
    }
    coverage.push({
      effectId: record.id,
      program,
      file,
      status,
      sourceBytes: Buffer.byteLength(source),
      normalizedBytes: Buffer.byteLength(normalized.source),
      generatedBytes,
    })
    if (status === 'generated') {
      factories.push({ key: `${record.id}:${program}`, source: factorySource(factories.length, record.id, transpiled, normalized, source) })
    }
  }
}

const moduleSource = `// Generated by scripts/upstream/compile-glsl.js. Do not edit.\n` +
  `export const programCoverage = Object.freeze(${JSON.stringify(coverage, null, 2)})\n`
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, moduleSource)
const kernelModuleSource = `// Generated by scripts/upstream/compile-glsl.js. Do not edit.\n` +
  factories.map((factory) => factory.source).join('\n') + '\n' +
  `export const canonicalKernelFactories = Object.freeze({\n` +
  factories.map((factory, index) => `  ${JSON.stringify(factory.key)}: canonicalFactory${index},`).join('\n') + '\n})\n'
await writeFile(kernelsPath, kernelModuleSource)
if (!paletteData || !historicPaletteData) throw new Error('Canonical adapter palette tables were not generated')
const adapterDataModule = `// Generated by scripts/upstream/compile-glsl.js. Do not edit.\n` +
  `export const paletteData = Object.freeze(${JSON.stringify(paletteData)}.map((entry) => Object.freeze(entry)))\n` +
  `export const historicPaletteData = Object.freeze(${JSON.stringify(historicPaletteData)}.map((entry) => Object.freeze(entry)))\n`
await writeFile(adapterDataPath, adapterDataModule)
console.log(`Classified ${coverage.length} canonical programs: ${coverage.filter((item) => item.status === 'generated').length} generated, ${coverage.filter((item) => item.status === 'adapter').length} adapters`)
