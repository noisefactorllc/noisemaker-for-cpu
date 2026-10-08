#!/usr/bin/env node

import GLSL from 'glsl-transpiler'
import { createHash } from 'node:crypto'
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

// Names (not values) of every #define a program's body reads as an ordinary identifier: from
// effect-level globals declaring `define: 'MACRO'` (NOISE_TYPE, renderLandscape3d's own
// VIEW_MODE, ...) AND, as of reference 0ed489ec, from a pass's own `defines` override
// (pointsRender/pointsBillboardRender's per-viewMode deposit/depthKeys/depositDefocus variants -
// `defines: {VIEW_MODE: n, ...}` from the definition's `.flatMap()`, never on a global). Each
// gets declared as an ordinary `uniform` below (see normalizeCanonicalGlsl's `runtimeDefines`
// option), not resolved to a literal: a bare `#if MACRO == N` with no matching `#define` isn't
// eliminated by glsl-transpiler, it's carried through as a normal runtime `if` - so binding the
// value through $bindings at call time (see src/runtime/renderer.js) reproduces the reference's
// per-pass-variant selection without needing a separate compiled kernel per combination.
function runtimeDefines(record) {
  const defines = Object.fromEntries(Object.values(record.params).filter((param) => param.define).map((param) => [
    param.define,
    param.type === 'float' ? 'float' : 'int',
  ]))
  for (const pass of record.passes ?? []) {
    for (const [name, value] of Object.entries(pass.defines ?? {})) {
      if (!(name in defines)) defines[name] = Number.isInteger(value) ? 'int' : 'float'
    }
  }
  return defines
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

// glsl-transpiler types only the GLSL ES 1.0 builtins. A call to an untyped one
// (GLSL ES 3.0's round, trunc, tanh, ...) gets no type, so `s * round(v)` is
// emitted as a scalar product and multiplies a number by an array: NaN for every
// component (classicNoisedeck shapes3d's and noise3d's `p -= s * round(p / s)`
// domain repetition). These are component-wise genType functions like floor; the
// stubs only carry that type, because the kernels call the runtime's stdlib.
const COMPONENT_WISE_ES3_BUILTINS = ['round', 'roundEven', 'trunc', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh']
for (const name of COMPONENT_WISE_ES3_BUILTINS) {
  if (GLSL.prototype.stdlib[name]) continue
  const typed = { [name]() {} }[name]
  typed.type = GLSL.prototype.stdlib.floor.type
  GLSL.prototype.stdlib[name] = typed
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

function restoreUnsignedIntegerArithmetic(transpiled, originalSource) {
  // The transpiler loses uvec type information when GLSL mixes uint vector
  // components with the bare operators (hash3/hash4-style LCG mixing), and
  // emits raw JS arithmetic: JS float64 cannot represent uint multiply-add
  // mod 2^32 once products exceed 2^53, `>>` is an arithmetic shift while
  // GLSL uint `>>` is logical, and float(uint) must convert the unsigned bit
  // pattern. Restore exact GLSL uint semantics statement-by-statement. Only
  // statements whose integer operands trace back to u-suffixed GLSL literals
  // (or same-vector component products) are rewritten; everything else keeps
  // its lowered form.
  const uintLiterals = new Set([...originalSource.matchAll(/\b(\d+)u\b/g)].map((m) => m[1]))
  if (uintLiterals.size === 0) return transpiled
  const uintExact = new Map([...uintLiterals].map((v) => [String(Math.fround(Number(v))), v]))
  const exact = (token) => uintLiterals.has(token) ? token : (uintExact.get(token) ?? null)
  let out = transpiled
  // q[i] = q[i] * <uconst> + <uconst>  ->  q[i] = (umul(q[i], <uconst>) + <uconst>) >>> 0
  out = out.replace(/([A-Za-z_$]\w*)\[(\d+)\] = \1\[\2\] \* (\d+) \+ (\d+)/g, (m, name, i, a, b) => {
    const ua = exact(a)
    if (ua === null || exact(b) === null) return m
    return `${name}[${i}] = (cpu_umul(${name}[${i}], ${ua}) + ${b === ua ? b : exact(b)}) >>> 0`
  })
  // q[i] += q[j] * q[k]  ->  q[i] = (q[i] + umul(q[j], q[k])) >>> 0
  out = out.replace(/([A-Za-z_$]\w*)\[(\d+)\] \+= \1\[(\d+)\] \* \1\[(\d+)\]/g, (m, name, i, j, k) =>
    `${name}[${i}] = (${name}[${i}] + cpu_umul(${name}[${j}], ${name}[${k}])) >>> 0`)
  // q[i] ^= q[i] >> <n>  ->  q[i] = (q[i] ^ (q[i] >>> <n>)) >>> 0
  out = out.replace(/([A-Za-z_$]\w*)\[(\d+)\] \^= \1\[\2\] >> (\d+)/g, (m, name, i, n) =>
    `${name}[${i}] = (${name}[${i}] ^ (${name}[${i}] >>> ${n})) >>> 0`)
  // float(uint) of a component XOR chain converts the unsigned bit pattern.
  out = out.replace(/cpu_float\(\(\(q\[(\d+)\] \^ q\[(\d+)\]\) \^ q\[(\d+)\]\) \^ q\[(\d+)\]\)/g,
    'cpu_float((((q[$1] ^ q[$2]) ^ q[$3]) ^ q[$4]) >>> 0)')
  out = out.replace(/cpu_float\(\(q\[(\d+)\] \^ q\[(\d+)\]\) \^ q\[(\d+)\]\)/g,
    'cpu_float(((q[$1] ^ q[$2]) ^ q[$3]) >>> 0)')
  out = out.replace(/cpu_float\(\(q\[(\d+)\] \^ q\[(\d+)\]\)\)/g,
    'cpu_float(((q[$1] ^ q[$2])) >>> 0)')
  if (/cpu_umul\(/.test(out) && !/function cpu_umul\s*\(/.test(out)) {
    out = `function cpu_umul (left, right) { return $runtime.stdlib.umul(left, right); };\n${out}`
  }
  return out
}

function restoreIntegerDivision(transpiled, originalSource, effectId) {
  // GLSL int/int division truncates toward zero; the transpiler loses int typing on
  // component-indexed operands (e.g. `int z = pixelCoord.y / volSize;` inside the volume
  // atlas mapping) and emits a raw float64 division, shifting every sampled coordinate.
  // Narrow statement-level rewrite only: `vec[i] / intName` where the divisor is a
  // provably int-typed GLSL identifier. Broader expression-level rewrites were measured
  // against fresh M4/Metal authority captures and REJECTED: the authority's rendered
  // output for filter/spookyTicker matches the untruncated lowering, not the pinned
  // GLSL's int-division semantics, so sub-expression rewrites diverge.
  // Integer casts (`float(x)`) and literals are left untouched.
  const intNames = new Set()
  for (const m of originalSource.matchAll(/\buniform\s+int\s+([A-Za-z_$]\w*)/g)) intNames.add(m[1])
  for (const m of originalSource.matchAll(/\bint\s+([A-Za-z_$]\w*)\s*(?:=|;)/g)) intNames.add(m[1])
  for (const m of originalSource.matchAll(/\bivec[234]\s+([A-Za-z_$]\w*)/g)) intNames.add(m[1])
  if (intNames.size === 0) return transpiled
  let out = transpiled.replace(/var ([A-Za-z_$]\w*) = ([A-Za-z_$]\w*)\[(\d+)\] \/ ([A-Za-z_$]\w*);/g, (m, name, vec, idx, divisor) => {
    if (!intNames.has(divisor)) return m
    return `var ${name} = Math.trunc(${vec}[${idx}] / ${divisor});`
  })
  // Statement-level scalar/scalar form (synth3d/shape3d: `int z = yAtlas / volumeSize;` where
  // yAtlas is a scalar int local). Both operands are provably int-typed GLSL identifiers, so
  // GLSL truncates toward zero; the transpiler's raw float64 division shifted every volume
  // z-slice coordinate. filter/spookyTicker is EXEMPT: its pinned M4/Metal authority capture
  // matches the untruncated lowering for `glyph_idx = lx / cell_stride` (measured), so
  // truncating it regresses the gate.
  if (effectId !== 'filter/spookyTicker') {
    out = out.replace(/var ([A-Za-z_$]\w*) = ([A-Za-z_$]\w*) \/ ([A-Za-z_$]\w*);/g, (m, name, dividend, divisor) => {
      if (!intNames.has(divisor) || !intNames.has(dividend)) return m
      if (dividend === divisor) return m
      return `var ${name} = Math.trunc(${dividend} / ${divisor});`
    })
  }
  return out
}

// GLSL `uint(A) <op> uint(B)` flattens to the raw JS `A|0 <op> B|0`. `|` binds
// looser than every arithmetic and comparison operator, so the left cast's
// `|0` never closes at its own operand: the operator and the right operand
// merge into it (octaveWarp's `uint(abs(p.x) * 2.0) + uint(p.x < 0.0)`
// evaluated as the comparison `(abs(p.x) * 2 + p.x) < 0` — a 0/1 flag instead
// of a hash seed). Parenthesize each flattened cast unit so the emitted
// expression reproduces the GLSL tree. Only sources containing a both-cast
// pair are touched; literal left casts emit without `|0` and already parse
// correctly (the LCG constants), and every rewrite must find the transpiler's
// verbatim operand emission (component swizzles become indexed reads) or the
// build fails instead of shipping a silently miscompiled kernel.
function preserveUintCastOperands(transpiled, originalSource) {
  if (!/\buint\s*\(/.test(originalSource)) return transpiled
  const calls = []
  for (const open of originalSource.matchAll(/\buint\s*\(/g)) {
    let depth = 1
    let cursor = open.index + open[0].length
    while (cursor < originalSource.length && depth > 0) {
      if (originalSource[cursor] === '(') depth += 1
      else if (originalSource[cursor] === ')') depth -= 1
      cursor += 1
    }
    if (depth !== 0) break
    calls.push({ outerStart: open.index, innerStart: open.index + open[0].length, innerEnd: cursor - 1 })
  }
  const emitted = (expression) => expression.replace(/\.([xyzw])\b/g, (_, component) => `[${'xyzw'.indexOf(component)}]`)
  const escaped = (text) => text.replace(/[^A-Za-z0-9_ ]/g, (char) => `\\${char}`)
  const literal = (expression) => /^-?\s*\d+(?:\.\d+)?\s*$/.test(expression)
  let output = transpiled
  for (let index = 0; index + 1 < calls.length; index += 1) {
    const between = originalSource.slice(calls[index].innerEnd + 1, calls[index + 1].outerStart)
    const operator = between.match(/^\s*([+\-*/%])\s*$/)?.[1]
    if (!operator) continue
    const leftInner = originalSource.slice(calls[index].innerStart, calls[index].innerEnd)
    const rightInner = originalSource.slice(calls[index + 1].innerStart, calls[index + 1].innerEnd)
    index += 1
    if (literal(leftInner)) continue
    const left = emitted(leftInner)
    const right = emitted(rightInner)
    const rightUnit = literal(rightInner) ? right : `(${right}|0)`
    const needle = new RegExp(`(?<![A-Za-z0-9_.$)\\]])${escaped(left)}\\|0\\s*${escaped(operator)}\\s*${escaped(right)}(?:\\|0)?(?![A-Za-z0-9_.$])`)
    if (!needle.test(output)) {
      throw new Error(`Unable to preserve uint cast operands for GLSL \`uint(${leftInner}) ${operator} uint(${rightInner})\`: the flattened emission was not found`)
    }
    output = output.replace(needle, () => `(${left}|0) ${operator} ${rightUnit}`)
  }
  return output
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

// GLSL value semantics: `vecN v = u;` copies. The glsl-transpiler emits a bare alias
// (`var z = pos;`), so a subsequent component write (mandelbulb's `z[0] = ...`) destroys
// the aliased source and the `+= pos` recurrence collapses to `2 * z^8` — NaN volumes in
// synth3d/fractal3d. Scalars pass through untouched; vectors get a pool-backed copy.
function copyAliasedVectorDeclarations(transpiled) {
  let depth = 0
  return transpiled.split('\n').map((line) => {
    let copied = line
    if (depth > 0) {
      copied = copied.replace(/var ([A-Za-z_$][\w$]*) = ([A-Za-z_$][\w.$]*);/g, (match, name, initializer) => {
        if (initializer === name) return match
        return `var ${name} = ${initializer} instanceof Float32Array ? $runtime.copy(${initializer}) : ${initializer};`
      })
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    return copied
  }).join('\n')
}

// GLSL `vecN == vecN` is one bool, true when every component is equal; `!=` is
// true when any component differs. glsl-transpiler emits both as a component-wise
// `new Float32Array([a[0] == b[0], ...])`, an object that is always truthy, so every
// ternary and `if` on a vector comparison took its first branch: lensDistortion's
// tint never applied, the coalesce/refract/feedback dodge and burn blends always
// kept one input, colorLab's channel masks and render3d's first-voxel normal test
// were constant. Each such literal reduces to the scalar GLSL result. A bvec
// constructor (`bvec3(x == y, ...)`) keeps its array: the transpiler emits it with a
// `.map(bool)` suffix, and the `equal()`/`notEqual()` builtins are function calls.
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let begin = 0
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if ('([{'.includes(character)) depth += 1
    else if (')]}'.includes(character)) depth -= 1
    else if (character === ',' && depth === 0) {
      parts.push(text.slice(begin, index))
      begin = index + 1
    }
  }
  parts.push(text.slice(begin))
  return parts
}

function topLevelComparison(expression) {
  let depth = 0
  let found = null
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index]
    if ('([{'.includes(character)) depth += 1
    else if (')]}'.includes(character)) depth -= 1
    else if (depth === 0) {
      if ('?&|'.includes(character)) return null
      const pair = expression.slice(index, index + 2)
      if ((pair === '==' || pair === '!=') && expression[index + 2] !== '=') {
        if (found) return null
        found = pair
        index += 1
      }
    }
  }
  return found
}

function reduceVectorEquality(transpiled) {
  const marker = 'new Float32Array(['
  let output = ''
  let cursor = 0
  for (let start = transpiled.indexOf(marker); start >= 0; start = transpiled.indexOf(marker, cursor)) {
    const open = start + marker.length - 1
    let depth = 0
    let close = -1
    for (let index = open; index < transpiled.length; index += 1) {
      const character = transpiled[index]
      if ('([{'.includes(character)) depth += 1
      else if (')]}'.includes(character)) {
        depth -= 1
        if (depth === 0) {
          close = index
          break
        }
      }
    }
    const elements = close > open ? splitTopLevel(transpiled.slice(open + 1, close)) : []
    const operators = elements.map(topLevelComparison)
    const operator = operators[0]
    const reducible = elements.length >= 2 && transpiled[close + 1] === ')' &&
      !transpiled.startsWith('.map(', close + 2) &&
      (operator === '==' || operator === '!=') && operators.every((each) => each === operator)
    if (!reducible) {
      output += transpiled.slice(cursor, open + 1)
      cursor = open + 1
      continue
    }
    const joined = elements.map((element) => reduceVectorEquality(element.trim())).join(operator === '==' ? ' && ' : ' || ')
    output += `${transpiled.slice(cursor, start)}(${joined})`
    cursor = close + 2
  }
  return output + transpiled.slice(cursor)
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

// glsl-transpiler distributes a whole-vector `==`/`!=` per component, and once
// that is combined with || or && no JavaScript form recovers the GLSL meaning:
// colorLab's `coord.xy == vec2(1.0) || coord.xy == vec2(3.0)` became
// `[(x == 1) || (x == 3), (y == 1) || (y == 3)]`, true for (1, 3). Every vector
// comparison in the catalog tests an identifier or swizzle against a vecN
// literal, so those become all(equal()) and any(notEqual()) before transpiling.
// reduceVectorEquality below still reduces any other comparison literal.
function lowerVectorEquality(source) {
  return source.replace(/\b([A-Za-z_]\w*(?:\.\w+)*)\s*(==|!=)\s*(vec[234]\s*\([^()]*\))/g, (match, left, operator, right) =>
    operator === '==' ? `all(equal(${left}, ${right}))` : `any(notEqual(${left}, ${right}))`)
}

function adaptCanonicalSource(effectId, source) {
  source = lowerVectorEquality(source)
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
  if (effectId === 'render/renderLandscape3d') {
    source = source
      .replaceAll(
        'if (hit.distance < 0.0) return;',
        'float hitDist = hit.distance;\n        if (hitDist < 0.0) return;',
      )
      .replaceAll('if (hit.distance > distance)', 'if (hitDist > distance)')
      .replaceAll('hit.distance / 320.0', 'hitDist / 320.0')
      .replaceAll('hit.distance / (size * 4.0)', 'hitDist / (size * 4.0)')
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
  if (effectId === 'render/renderLandscape3d') {
    transpiled = transpiled
      .replace(
        'atlasCoords(position).reduce((res,el,i)=>(res[i] = el, res), coords);',
        'coords = atlasCoords(position);',
      )
      .replace(
        '(coords[0] = candidateCoords[0], coords[1] = candidateCoords[1], coords);',
        'coords = candidateCoords;',
      )
  }
  transpiled = lowerUnsignedJavaScript(transpiled, originalSource)
  transpiled = preserveUintCastOperands(transpiled, originalSource)
  // ANGLE's optimized scatter hash straddles a nearest-sampling boundary in
  // the canonical default. Its original scalar lowering matches that backend;
  // strict literal lowering moves one texel to the opposite side.
  if (effectId !== 'filter/scatter') transpiled = lowerFloatLiterals(transpiled)
  transpiled = preserveIntCastPrecedence(transpiled)
  transpiled = restoreUnsignedIntegerArithmetic(transpiled, originalSource)
  transpiled = restoreIntegerDivision(transpiled, originalSource, effectId)
  transpiled = reduceVectorEquality(transpiled)
  transpiled = copyAliasedVectorDeclarations(transpiled)
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
      // sha256 of the exact canonical source bytes this kernel was built from,
      // recorded so tests can tie the committed kernels to the pinned tree's
      // GLSL via scripts/upstream/pinned-source-manifest.json: if upstream GLSL
      // changes and the kernels are not regenerated, these hashes stop
      // matching the manifest and the suite fails instead of silently shipping
      // stale kernels.
      sourceSha256: createHash('sha256').update(source).digest('hex'),
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
