import { DslError } from './error.js'
import { tokenizeDsl } from './tokenize.js'

function location(token) {
  return { sourceName: token.sourceName, line: token.line, column: token.column, index: token.index }
}

function parseColor(lexeme) {
  let hex = lexeme.slice(1)
  if (hex.length === 3) hex = [...hex].map((char) => char + char).join('')
  const values = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  if (hex.length === 8) values.push(Number.parseInt(hex.slice(6, 8), 16) / 255)
  return values
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens
    this.current = 0
  }

  peek(offset = 0) { return this.tokens[Math.min(this.current + offset, this.tokens.length - 1)] }
  previous() { return this.tokens[this.current - 1] }
  atEnd() { return this.peek().type === 'eof' }
  check(lexeme) { return this.peek().lexeme === lexeme }
  match(...lexemes) {
    if (!lexemes.includes(this.peek().lexeme)) return false
    this.current += 1
    return true
  }
  consume(lexeme, message = `Expected ${JSON.stringify(lexeme)}`) {
    if (!this.check(lexeme)) throw new DslError(message, location(this.peek()))
    return this.tokens[this.current++]
  }
  identifier(message = 'Expected identifier') {
    const token = this.peek()
    if (token.type !== 'identifier') throw new DslError(message, location(token))
    this.current += 1
    return token
  }

  parseProgram() {
    const ast = { kind: 'DslProgram', search: [], bindings: [], chains: [], render: null, loc: location(this.peek()) }
    if (this.match('search')) {
      do ast.search.push(this.identifier('Expected namespace after search').lexeme)
      while (this.match(','))
      this.match(';')
    }
    while (!this.atEnd()) {
      if (this.match(';')) continue
      if (this.match('let')) {
        ast.bindings.push(this.parseBinding(this.previous()))
      } else if (this.match('render')) {
        if (ast.render) throw new DslError('Program may only declare one render surface', location(this.previous()))
        const start = this.previous()
        this.consume('(')
        ast.render = this.parseSurface()
        ast.render.loc = location(start)
        this.consume(')')
        this.match(';')
      } else {
        ast.chains.push(this.parseChain())
        this.match(';')
      }
    }
    return ast
  }

  parseBinding(start) {
    const name = this.identifier('Expected binding name after let')
    this.consume('=')
    let value
    if (this.peek().type === 'identifier' && this.peek(1).lexeme === '(') value = this.parseCall()
    else value = this.parseValueExpression()
    this.match(';')
    return { kind: 'Binding', name: name.lexeme, value, loc: location(start) }
  }

  parseChain() {
    const first = this.parseCall()
    const calls = [first]
    while (this.match('.')) calls.push(this.parseCall())
    return { kind: 'Chain', calls, loc: first.loc }
  }

  parseCall() {
    const name = this.identifier('Expected effect or IO function name')
    this.consume('(')
    const args = []
    let mode = null
    if (!this.check(')')) {
      do {
        const isNamed = this.peek().type === 'identifier' && this.peek(1).lexeme === ':'
        const nextMode = isNamed ? 'named' : 'positional'
        if (mode && mode !== nextMode) throw new DslError('Cannot mix positional and named arguments', location(this.peek()))
        mode = nextMode
        let argName = null
        if (isNamed) {
          argName = this.identifier().lexeme
          this.consume(':')
        }
        const start = this.peek()
        args.push({ name: argName, value: this.parseValueExpression(), loc: location(start) })
      } while (this.match(','))
    }
    this.consume(')')
    return { kind: 'Call', name: name.lexeme, args, argMode: mode, loc: location(name) }
  }

  parseValueExpression(minPrecedence = 0) {
    let left = this.parseValueUnary()
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 }
    while ((precedence[this.peek().lexeme] ?? -1) >= minPrecedence) {
      const operator = this.tokens[this.current++]
      const right = this.parseValueExpression(precedence[operator.lexeme] + 1)
      left = { kind: 'binary', operator: operator.lexeme, left, right, loc: location(operator) }
    }
    return left
  }

  parseValueUnary() {
    if (this.match('-', '+')) {
      const operator = this.previous()
      return { kind: 'unary', operator: operator.lexeme, argument: this.parseValueUnary(), loc: location(operator) }
    }
    return this.parseValuePrimary()
  }

  parseValuePrimary() {
    const token = this.peek()
    if (token.type === 'number') {
      this.current += 1
      return token.value
    }
    if (token.type === 'string') {
      this.current += 1
      return token.value
    }
    if (token.lexeme === 'true' || token.lexeme === 'false') {
      this.current += 1
      return token.lexeme === 'true'
    }
    if (token.type === 'color') {
      this.current += 1
      return parseColor(token.lexeme)
    }
    if (token.type === 'surface') return this.parseSurface()
    if (this.match('[')) {
      const values = []
      if (!this.check(']')) {
        do values.push(this.parseValueExpression())
        while (this.match(','))
      }
      this.consume(']')
      return values
    }
    if (this.match('(')) {
      const value = this.parseValueExpression()
      this.consume(')')
      return value
    }
    if (token.type === 'identifier') {
      this.current += 1
      const name = token.lexeme
      if (name === 'read' && this.match('(')) {
        if (this.peek().type === 'identifier' && this.peek(1).lexeme === ':') {
          const argumentName = this.identifier().lexeme
          if (argumentName !== 'surface' && argumentName !== 'tex') {
            throw new DslError('read() surface argument must be named "surface" or "tex"', location(this.previous()))
          }
          this.consume(':')
        }
        const surface = this.parseSurface()
        this.consume(')')
        return surface
      }
      if (['vec2', 'vec3', 'vec4'].includes(name) && this.match('(')) {
        const values = []
        if (!this.check(')')) {
          do values.push(this.parseValueExpression())
          while (this.match(','))
        }
        this.consume(')')
        return { kind: 'vector', width: Number(name.at(-1)), values, loc: location(token) }
      }
      let path = name
      while (this.match('.')) path += `.${this.identifier('Expected enum member').lexeme}`
      return { kind: 'identifier', name: path, loc: location(token) }
    }
    throw new DslError('Expected DSL value', location(token))
  }

  parseSurface() {
    const token = this.peek()
    if (token.type !== 'surface') throw new DslError('Expected surface reference', location(token))
    this.current += 1
    const index = Number(token.lexeme.slice(1))
    if (index < 0 || index > 7) throw new DslError('Surface reference must be o0 through o7', location(token))
    return { kind: 'surface', name: token.lexeme, loc: location(token) }
  }
}

export function parseDsl(source, options = {}) {
  return new Parser(tokenizeDsl(source, options)).parseProgram()
}
