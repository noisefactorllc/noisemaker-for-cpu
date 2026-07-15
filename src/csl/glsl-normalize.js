function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function runtimeDefineIn(expression, runtimeDefines) {
  return Object.keys(runtimeDefines).find((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(expression)) ?? null
}

function countBraces(line, state) {
  let delta = 0
  let index = 0
  while (index < line.length) {
    if (state.blockComment) {
      const end = line.indexOf('*/', index)
      if (end === -1) return delta
      state.blockComment = false
      index = end + 2
      continue
    }
    if (line.startsWith('//', index)) return delta
    if (line.startsWith('/*', index)) {
      state.blockComment = true
      index += 2
      continue
    }
    if (line[index] === '{') delta += 1
    else if (line[index] === '}') delta -= 1
    index += 1
  }
  return delta
}

function expandMacros(source, macros) {
  let expanded = source
  for (let iteration = 0; iteration < 8; iteration += 1) {
    let changed = false
    for (const [name, value] of macros) {
      const next = expanded.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g'), value)
      if (next !== expanded) changed = true
      expanded = next
    }
    if (!changed) break
  }
  return expanded
}

function normalizeUnsigned(source) {
  const widths = [...new Set([...source.matchAll(/\buvec([234])\b/g)].map((match) => Number(match[1])))]
  const nonUnsignedNames = new Set([...source.matchAll(/\b(?:float|int|bool|[bi]?vec[234]|mat[234])\s+([A-Za-z_]\w*)\b/g)].map((match) => match[1]))
  const scalarNames = [...new Set([...source.matchAll(/\buint\s+([A-Za-z_]\w*)\b/g)].map((match) => match[1]))]
    .filter((name) => !nonUnsignedNames.has(name))
  let normalized = source
    .replace(/\bfloat\s*\(\s*uint\s*\(\s*0xffffffffu?\s*\)\s*\)/gi, '4294967295.0')
    .replace(/\bfloat\s*\(\s*0xffffffffu\s*\)/gi, '4294967295.0')
    .replace(/\buvec([234])\s*\(/g, 'cpu_uvec$1(')
    .replace(/\b(0x[\dA-Fa-f]+|\d+)u\b/g, '$1')
    .replace(/\buint\b/g, 'int')
    .replace(/\buvec([234])\b/g, 'vec$1')
  for (const name of scalarNames) {
    normalized = normalized
      .replace(new RegExp(`\\b${escapeRegExp(name)}\\s*\\*\\s*(0x[\\dA-Fa-f]+|\\d+)(?![\\d.])`, 'g'), `cpu_umul(${name}, $1)`)
      .replace(new RegExp(`(?<![\\w.])(0x[\\dA-Fa-f]+|\\d+)\\s*\\*\\s*\\b${escapeRegExp(name)}\\b`, 'g'), `cpu_umul($1, ${name})`)
  }
  if (normalized.includes('cpu_umul(')) normalized = `int cpu_umul(int left, int right) { return left * right; }\n${normalized}`
  if (widths.length > 0) {
    const helpers = widths.flatMap((width) => {
      const type = `vec${width}`
      const args = Array.from({ length: width }, (_, index) => `float v${index}`).join(', ')
      const values = Array.from({ length: width }, (_, index) => `v${index}`).join(', ')
      return [
        `${type} cpu_uvec${width}(float value) { return ${type}(value); }`,
        `${type} cpu_uvec${width}(${type} value) { return value; }`,
        `${type} cpu_uvec${width}(${args}) { return ${type}(${values}); }`,
      ]
    }).join('\n')
    normalized = `${helpers}\n${normalized}`
  }
  return normalized
}

function normalizeSignedIntegerVectors(source) {
  const widths = [...new Set([...source.matchAll(/\bivec([234])\b/g)].map((match) => Number(match[1])))]
  if (widths.length === 0) return source
  let normalized = source.replace(/\bivec([234])\s*\(/g, 'cpu_ivec$1(')
  const helpers = widths.flatMap((width) => {
    const type = `vec${width}`
    const args = Array.from({ length: width }, (_, index) => `float v${index}`).join(', ')
    const values = Array.from({ length: width }, (_, index) => `v${index}`).join(', ')
    return [
      `${type} cpu_ivec${width}(float value) { return ${type}(value); }`,
      `${type} cpu_ivec${width}(${type} value) { return value; }`,
      `${type} cpu_ivec${width}(${args}) { return ${type}(${values}); }`,
    ]
  }).join('\n')
  return `${helpers}\n${normalized}`
}

function renameUniformShadows(source) {
  const uniforms = new Set([...source.matchAll(/\buniform\s+\w+\s+([A-Za-z_]\w*)/g)].map((match) => match[1]))
  if (uniforms.size === 0) return source
  const active = []
  const counts = new Map()
  const braceState = { blockComment: false }
  let depth = 0
  const declaration = /\b(?:const\s+)?(?:float|int|bool|vec[234]|ivec[234]|mat[234])\s+([A-Za-z_]\w*)\b/

  return source.split('\n').map((originalLine) => {
    let line = originalLine
    for (const item of active) line = line.replace(new RegExp(`\\b${escapeRegExp(item.name)}\\b`, 'g'), item.replacement)

    if (depth > 0) {
      const match = originalLine.match(declaration)
      const name = match?.[1]
      if (name && uniforms.has(name)) {
        const count = (counts.get(name) ?? 0) + 1
        counts.set(name, count)
        const replacement = `_local_${name}_${count}`
        const declarationOffset = line.indexOf(name, match.index)
        if (declarationOffset !== -1) {
          line = `${line.slice(0, declarationOffset)}${replacement}${line.slice(declarationOffset + name.length)}`
          active.push({ name, replacement, depth })
        }
      }
    }

    depth += countBraces(originalLine, braceState)
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (depth < active[index].depth) active.splice(index, 1)
    }
    return line
  }).join('\n')
}

export function normalizeCanonicalGlsl(source, options = {}) {
  const sourceName = options.sourceName ?? '<canonical GLSL>'
  const runtimeDefines = options.runtimeDefines ?? {}
  const outputs = []
  const varyings = []
  const macros = new Map()
  const stack = []
  const braceState = { blockComment: false }
  let depth = 0

  const blockLoweredSource = source.replace(
    /layout\s*\([^)]*\)\s*uniform\s+[A-Za-z_]\w*\s*\{([\s\S]*?)\}\s*;/g,
    (_, body) => body.split(/\r?\n/).map((line) => {
      const trimmed = line.trim()
      return trimmed && !trimmed.startsWith('//') ? `uniform ${trimmed}` : line
    }).join('\n'),
  )

  const normalizedLines = blockLoweredSource.replace(/\r\n?/g, '\n').split('\n').map((line) => {
    if (/^\s*#version\b/.test(line)) return ''

    const ifMatch = line.match(/^\s*#(if|ifdef|ifndef)\s+(.+?)\s*$/)
    if (ifMatch) {
      const [, directive, expression] = ifMatch
      const plainName = expression.trim()
      const defineName = runtimeDefineIn(expression, runtimeDefines)
      if (directive === 'ifdef' && plainName === 'GL_ES') {
        stack.push({ kind: 'platform', defineName: 'GL_ES', inner: false })
        return ''
      }
      if (directive === 'ifndef' && defineName && plainName === defineName) {
        stack.push({ kind: 'default', defineName, inner: false })
        return ''
      }
      if (defineName) {
        const condition = directive === 'ifdef' ? `${defineName} != 0` : directive === 'ifndef' ? `${defineName} == 0` : expression
        const branch = { kind: 'runtime', defineName, inner: depth > 0 }
        stack.push(branch)
        return branch.inner ? `if (${condition}) {` : ''
      }
      stack.push({ kind: 'static', defineName: null, inner: false })
      return line
    }

    const elifMatch = line.match(/^\s*#elif\s+(.+?)\s*$/)
    if (elifMatch) {
      const branch = stack.at(-1)
      if (branch?.kind === 'runtime') return branch.inner ? `} else if (${elifMatch[1]}) {` : ''
      return line
    }
    if (/^\s*#else\b/.test(line)) {
      const branch = stack.at(-1)
      if (branch && branch.kind !== 'static') return branch.kind === 'runtime' && branch.inner ? '} else {' : ''
      return line
    }
    if (/^\s*#endif\b/.test(line)) {
      const branch = stack.pop()
      if (!branch) throw new SyntaxError(`${sourceName}: unmatched #endif`)
      if (branch.kind === 'runtime') return branch.inner ? '}' : ''
      return branch.kind === 'static' ? line : ''
    }

    const defineMatch = line.match(/^\s*#define\s+([A-Za-z_]\w*)\s+(.+?)\s*$/)
    if (defineMatch) {
      const [, name, rawValue] = defineMatch
      const value = rawValue.replace(/\s*\/\/.*$/, '').trim()
      if (name in runtimeDefines) return ''
      if (stack.some((branch) => branch.kind === 'static')) return line
      macros.set(name, value)
      return ''
    }

    let normalized = line
    normalized = normalized.replace(/layout\s*\([^)]*\)\s*out\s+vec4\s+([A-Za-z_]\w*)\s*;/g, (_, name) => {
      outputs.push(name)
      return `vec4 ${name};`
    })
    normalized = normalized.replace(/^\s*out\s+vec4\s+([A-Za-z_]\w*)\s*;/, (_, name) => {
      outputs.push(name)
      return `vec4 ${name};`
    })
    normalized = normalized.replace(/^\s*(?:flat\s+)?in\s+(vec[234])\s+([A-Za-z_]\w*)\s*;/, (_, type, name) => {
      varyings.push({ name, type })
      return `${type} ${name};`
    })
    depth += countBraces(line, braceState)
    return normalized
  })

  if (stack.length > 0) {
    const branch = [...stack].reverse().find((item) => item.kind !== 'static') ?? stack.at(-1)
    throw new SyntaxError(`${sourceName}: unterminated #if${branch.defineName ? ` for runtime define ${branch.defineName}` : ''}`)
  }

  const declarations = Object.entries(runtimeDefines).map(([name, type]) => `uniform ${type} ${name};`)
  let declarationIndex = 0
  for (let index = 0; index < normalizedLines.length; index += 1) {
    if (/^\s*precision\b/.test(normalizedLines[index])) declarationIndex = index + 1
  }
  normalizedLines.splice(declarationIndex, 0, ...declarations)
  let normalizedSource = renameUniformShadows(normalizeSignedIntegerVectors(normalizeUnsigned(expandMacros(normalizedLines.join('\n'), macros)))
    .replace(/\b([biu]?vec[234]|mat[234]|float|int|bool)\s+([A-Za-z_]\w*)\s*\[(\d+)\]\s*=\s*\1\s*\[\]\s*\(/g, '$1 $2[$3] = $1[$3](')
    .replace(/\bfloat\s*\(\s*([A-Za-z_]\w*(?:\.[xyzwrgba])?)\s*\)/g, '($1)')
    .replace(/\bpacked\b/g, '_packed'))
  const shadowedBuiltins = new Set([...normalizedSource.matchAll(/\b(?:float|int|bool|vec[234]|ivec[234])\s+(min|max)\b/g)].map((match) => match[1]))
  for (const name of shadowedBuiltins) normalizedSource = normalizedSource.replace(new RegExp(`\\b${name}\\b(?!\\s*\\()`, 'g'), `_${name}`)

  return Object.freeze({
    source: normalizedSource.endsWith('\n') ? normalizedSource : `${normalizedSource}\n`,
    outputs: Object.freeze([...new Set(outputs)]),
    varyings: Object.freeze(varyings),
    runtimeDefines: Object.freeze({ ...runtimeDefines }),
  })
}
