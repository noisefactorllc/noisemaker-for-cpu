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
const adapters = new Set([
  'classicNoisedeck/fractal',
  'filter/historicPalette',
  'filter/palette',
  'synth/julia',
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

function adaptCanonicalSource(effectId, source) {
  // glsl-transpiler flattens these common hash swizzles into scalar JS inside
  // one typed-array constructor, erasing the float32 operation boundaries
  // between the add and multiply. Explicit float casts retain the GLSL hash
  // result while still compiling to allocation-free Math.fround calls.
  if (effectId !== 'filter/scatter') {
    source = source
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
    source = source
      .replace(
        /float b = unpackHalf2x16\(blue\)\.x;/,
        'vec2 unpackedBlue = unpackHalf2x16(blue);\n    float b = unpackedBlue.x;',
      )
      .replace(
        /int medianIndex = 49 \/ 2;\s*int left = 0;\s*int right = 49 - 1;/,
        'int activeCount = (RADIUS * 2 + 1) * (RADIUS * 2 + 1);\n    int medianIndex = (activeCount - 1) >> 1;\n    int left = 0;\n    int right = activeCount - 1;',
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
    source = source
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
  return preserveFloatCasts(preserveTextureScalarSwizzles(preserveVectorAssignmentReads(preserveMatrixSelfAssignments(source))))
}

function factorySource(index, effectId, transpiled, normalized, originalSource) {
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
  return `function canonicalFactory${index}($bindings, $runtime) {\n` +
    (stdlibNames.length > 0 ? `  const { ${stdlibNames.join(', ')} } = $runtime.stdlib\n` : '') +
    `  const gl_FragCoord = $runtime.fragCoord\n` +
    transpiled.split('\n').map((line) => `  ${line}`).join('\n') + '\n' +
    `  return function canonicalKernel(context, out) {\n` +
    `    $runtime.beginPixel(context)\n` +
    (varyingCopies ? `${varyingCopies}\n` : '') +
    `    main()\n` +
    `    $runtime.writeColor(fragColor, out)\n` +
    `  }\n` +
    `}\n` +
    (/\b(?:dFdx|dFdy|fwidth)\s*\(/.test(originalSource) ? `canonicalFactory${index}.usesDerivatives = true\n` : '')
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
    const sourceName = `${record.id}/glsl/${file}`
    const source = await readFile(resolve(glslDirectory, file), 'utf8')
    if (record.id === 'filter/palette') paletteData = parsePaletteEntries(source)
    if (record.id === 'filter/historicPalette') historicPaletteData = parseHistoricPaletteEntries(source)
    const rawNormalized = normalizeCanonicalGlsl(source, { sourceName, runtimeDefines: runtimeDefines(record) })
    const normalized = Object.freeze({ ...rawNormalized, source: adaptCanonicalSource(record.id, rawNormalized.source) })
    let generatedBytes = 0
    let transpiled = ''
    const status = adapters.has(record.id) ? 'adapter' : 'generated'
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
      program: file.slice(0, -extname(file).length),
      file,
      status,
      sourceBytes: Buffer.byteLength(source),
      normalizedBytes: Buffer.byteLength(normalized.source),
      generatedBytes,
    })
    if (status === 'generated') {
      factories.push({ key: `${record.id}:${file.slice(0, -extname(file).length)}`, source: factorySource(factories.length, record.id, transpiled, normalized, source) })
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
