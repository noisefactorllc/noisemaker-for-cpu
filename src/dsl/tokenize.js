import { DslError } from './error.js'

const KEYWORDS = new Set(['search', 'let', 'render', 'true', 'false'])
const PUNCTUATION = new Set(['(', ')', '[', ']', ',', '.', ':', '=', ';'])
const OPERATORS = new Set(['+', '-', '*', '/'])

export function tokenizeDsl(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('DSL source must be a string')
  const sourceName = options.sourceName ?? '<dsl>'
  const tokens = []
  let index = 0
  let line = 1
  let column = 1

  const start = () => ({ sourceName, line, column, index })
  const advance = () => {
    const char = source[index++]
    if (char === '\n') {
      line += 1
      column = 1
    } else column += 1
    return char
  }
  const push = (type, lexeme, location, value = undefined) => tokens.push({ type, lexeme, value, ...location })

  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) {
      advance()
      continue
    }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') advance()
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      const location = start()
      advance()
      advance()
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) advance()
      if (index >= source.length) throw new DslError('Unterminated block comment', location)
      advance()
      advance()
      continue
    }

    const location = start()
    if (char === '#') {
      let lexeme = advance()
      while (/[0-9a-fA-F]/.test(source[index] ?? '')) lexeme += advance()
      if (![4, 7, 9].includes(lexeme.length)) throw new DslError('Colors must use #RGB, #RRGGBB, or #RRGGBBAA', location)
      push('color', lexeme, location)
      continue
    }
    if (char === '"') {
      advance()
      let value = ''
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\n') throw new DslError('Unterminated string', location)
        if (source[index] === '\\') {
          advance()
          const escaped = advance()
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped
        } else value += advance()
      }
      if (index >= source.length) throw new DslError('Unterminated string', location)
      advance()
      push('string', value, location, value)
      continue
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] ?? ''))) {
      let lexeme = ''
      while (/\d/.test(source[index] ?? '')) lexeme += advance()
      if (source[index] === '.') {
        lexeme += advance()
        while (/\d/.test(source[index] ?? '')) lexeme += advance()
      }
      if (source[index] === 'e' || source[index] === 'E') {
        lexeme += advance()
        if (source[index] === '+' || source[index] === '-') lexeme += advance()
        while (/\d/.test(source[index] ?? '')) lexeme += advance()
      }
      push('number', lexeme, location, Number(lexeme))
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      let lexeme = advance()
      while (/[A-Za-z0-9_]/.test(source[index] ?? '')) lexeme += advance()
      const type = /^o\d+$/.test(lexeme) ? 'surface' : KEYWORDS.has(lexeme) ? 'keyword' : 'identifier'
      push(type, lexeme, location)
      continue
    }
    if (PUNCTUATION.has(char)) {
      advance()
      push('punctuation', char, location)
      continue
    }
    if (OPERATORS.has(char)) {
      advance()
      push('operator', char, location)
      continue
    }
    throw new DslError(`Unexpected character ${JSON.stringify(char)}`, location)
  }
  tokens.push({ type: 'eof', lexeme: '', sourceName, line, column, index })
  return tokens
}
