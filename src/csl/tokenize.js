import { CslError } from './error.js'

const KEYWORDS = new Set([
  'uniform',
  'const',
  'if',
  'else',
  'for',
  'return',
  'break',
  'continue',
  'true',
  'false',
  'void',
  'bool',
  'int',
  'float',
  'sampler2D',
  'vec2',
  'vec3',
  'vec4',
])

const TWO_CHAR_OPERATORS = new Set([
  '++', '--', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>',
])
const ONE_CHAR_OPERATORS = new Set(['=', '+', '-', '*', '/', '%', '<', '>', '!', '&', '|', '^'])
const PUNCTUATION = new Set(['(', ')', '{', '}', '[', ']', ',', ';', '.', '?', ':'])

function isIdentifierStart(char) {
  return /[A-Za-z_]/.test(char)
}

function isIdentifierContinue(char) {
  return /[A-Za-z0-9_]/.test(char)
}

export function tokenizeCsl(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('CSL source must be a string')

  const sourceName = options.sourceName ?? '<csl>'
  const tokens = []
  let index = 0
  let line = 1
  let column = 1

  const location = () => ({ sourceName, line, column, index })
  const advance = () => {
    const char = source[index]
    index += 1
    if (char === '\n') {
      line += 1
      column = 1
    } else {
      column += 1
    }
    return char
  }
  const push = (type, lexeme, start) => {
    tokens.push({ type, lexeme, line: start.line, column: start.column, index: start.index, sourceName })
  }

  while (index < source.length) {
    const char = source[index]

    if (/\s/.test(char)) {
      advance()
      continue
    }

    if (char === '/' && source[index + 1] === '/') {
      advance()
      advance()
      while (index < source.length && source[index] !== '\n') advance()
      continue
    }

    if (char === '/' && source[index + 1] === '*') {
      const start = location()
      advance()
      advance()
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) advance()
      if (index >= source.length) throw new CslError('Unterminated block comment', start)
      advance()
      advance()
      continue
    }

    const start = location()
    const two = source.slice(index, index + 2)
    if (TWO_CHAR_OPERATORS.has(two)) {
      advance()
      advance()
      push('operator', two, start)
      continue
    }

    if (ONE_CHAR_OPERATORS.has(char)) {
      advance()
      push('operator', char, start)
      continue
    }

    const next = source[index + 1]
    if (/\d/.test(char) || (char === '.' && /\d/.test(next))) {
      let lexeme = ''
      if (char !== '.') {
        while (index < source.length && /\d/.test(source[index])) lexeme += advance()
      }
      if (source[index] === '.') {
        lexeme += advance()
        while (index < source.length && /\d/.test(source[index])) lexeme += advance()
      }
      if (source[index] === 'e' || source[index] === 'E') {
        lexeme += advance()
        if (source[index] === '+' || source[index] === '-') lexeme += advance()
        if (!/\d/.test(source[index])) throw new CslError('Invalid numeric exponent', start)
        while (index < source.length && /\d/.test(source[index])) lexeme += advance()
      }
      push('number', lexeme, start)
      continue
    }

    if (PUNCTUATION.has(char)) {
      advance()
      push('punctuation', char, start)
      continue
    }

    if (isIdentifierStart(char)) {
      let lexeme = advance()
      while (index < source.length && isIdentifierContinue(source[index])) lexeme += advance()
      push(KEYWORDS.has(lexeme) ? 'keyword' : 'identifier', lexeme, start)
      continue
    }

    throw new CslError(`Unexpected character ${JSON.stringify(char)}`, start)
  }

  tokens.push({ type: 'eof', lexeme: '', line, column, index, sourceName })
  return tokens
}
