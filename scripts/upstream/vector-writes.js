// glsl-transpiler lowers a whole-vector assignment such as
// `p = vec2(dot(p, a), dot(p, b))` or `offset = dot(offset, perp) * perp` to
// in-place component writes: `(p[0] = dot(p, a), p[1] = dot(p, b), p)`.
// GLSL evaluates the whole right-hand side before it assigns, but this
// JavaScript writes p[0] before it evaluates the p[1] expression. When a later
// component expression reads the target, as a whole vector or through a
// component that is already written, it sees the new value.
//
// stageVectorComponentWrites evaluates every component expression of such a
// write into factory-scope temporaries first, then assigns the components.
// Writes whose component expressions read only their own component, or do not
// read the target, are left unchanged.

const IDENTIFIER = /[A-Za-z_$][\w$]*/y
const STAGE_PREFIX = 'cpu_vector_write_'

function matchingClose(text, open) {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    const character = text[index]
    if ('([{'.includes(character)) depth += 1
    else if (')]}'.includes(character)) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function splitTopLevelCommas(text) {
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
  return parts.map((part) => part.trim())
}

function escapeRegExp(text) {
  return text.replace(/[$]/g, '\\$&')
}

// Parse `(name[i] = expression, ..., name)`. Return null for any other shape.
function parseComponentWrite(inner) {
  const parts = splitTopLevelCommas(inner)
  if (parts.length < 3) return null
  const name = parts.at(-1)
  IDENTIFIER.lastIndex = 0
  if (!IDENTIFIER.test(name) || IDENTIFIER.lastIndex !== name.length) return null
  const pattern = new RegExp(`^${escapeRegExp(name)}\\[(\\d)\\] = ([\\s\\S]+)$`)
  const writes = []
  for (const part of parts.slice(0, -1)) {
    const match = pattern.exec(part)
    if (!match) return null
    writes.push({ component: Number(match[1]), expression: match[2] })
  }
  if (new Set(writes.map((write) => write.component)).size !== writes.length) return null
  return { name, writes }
}

// Reads of `name` in an expression: a component read `name[k]` with a literal
// index, or anything else (whole-vector read, computed index).
function reads(expression, name) {
  const pattern = new RegExp(`(?<![\\w$.])${escapeRegExp(name)}(?![\\w$])(\\[(\\d)\\])?`, 'g')
  return [...expression.matchAll(pattern)].map((match) => (match[2] === undefined ? 'whole' : Number(match[2])))
}

export function componentWriteHazard({ name, writes }) {
  const written = new Set()
  for (const { component, expression } of writes) {
    if (written.size > 0 && reads(expression, name).some((read) => read === 'whole' || written.has(read))) return true
    written.add(component)
  }
  return false
}

// Every in-place component write in `source`, with its offset and whether a
// later component expression reads a value that an earlier write replaced.
export function findComponentWrites(source) {
  const found = []
  const start = /\(([A-Za-z_$][\w$]*)\[\d\] = /g
  for (let match = start.exec(source); match; match = start.exec(source)) {
    const close = matchingClose(source, match.index)
    if (close < 0) continue
    const parsed = parseComponentWrite(source.slice(match.index + 1, close))
    if (!parsed) continue
    found.push({ index: match.index, end: close + 1, ...parsed, hazard: componentWriteHazard(parsed) })
  }
  return found
}

export function stageVectorComponentWrites(source) {
  if (source.includes(STAGE_PREFIX)) throw new Error(`Transpiled source already uses the reserved ${STAGE_PREFIX} prefix`)
  const temporaries = []
  let site = 0
  const stage = (text) => {
    let output = ''
    let cursor = 0
    const start = /\(([A-Za-z_$][\w$]*)\[\d\] = /g
    for (let match = start.exec(text); match; match = start.exec(text)) {
      const close = matchingClose(text, match.index)
      if (close < 0) continue
      const parsed = parseComponentWrite(text.slice(match.index + 1, close))
      if (!parsed) continue
      // Stage any nested writes inside the component expressions first.
      const writes = parsed.writes.map((write) => ({ ...write, expression: stage(write.expression) }))
      const nestedChanged = writes.some((write, index) => write.expression !== parsed.writes[index].expression)
      let replacement
      if (componentWriteHazard({ name: parsed.name, writes })) {
        const names = writes.map((write) => `${STAGE_PREFIX}${site}_${write.component}`)
        site += 1
        temporaries.push(...names)
        replacement = `(${[
          ...writes.map((write, index) => `${names[index]} = ${write.expression}`),
          ...writes.map((write, index) => `${parsed.name}[${write.component}] = ${names[index]}`),
          parsed.name,
        ].join(', ')})`
      } else if (nestedChanged) {
        replacement = `(${[...writes.map((write) => `${parsed.name}[${write.component}] = ${write.expression}`), parsed.name].join(', ')})`
      } else {
        replacement = text.slice(match.index, close + 1)
      }
      output += text.slice(cursor, match.index) + replacement
      cursor = close + 1
      start.lastIndex = cursor
    }
    return output + text.slice(cursor)
  }
  const staged = stage(source)
  if (temporaries.length === 0) return source
  return `var ${temporaries.join(', ')};\n${staged}`
}
