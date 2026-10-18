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
  // A string token's lexeme is its content, so a string never matches punctuation,
  // an operator or a keyword: `text(")")` holds the string ")".
  check(lexeme) { return this.peek().type !== 'string' && this.peek().lexeme === lexeme }
  match(...lexemes) {
    if (this.peek().type === 'string' || !lexemes.includes(this.peek().lexeme)) return false
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

  // `search` namespace lists are the one place a reserved keyword can legitimately name a
  // catalog namespace: `render` is both the `render(oN)` directive keyword (see KEYWORDS in
  // tokenize.js) and the real namespace owning `pointsEmit`/`pointsRender`/
  // `pointsBillboardRender`. Accepting the keyword token here — and ONLY here — lets
  // `search ..., render` resolve those effects without de-keywording `render` globally, which
  // would break the top-level `render(oN)` directive's own dispatch (`this.match('render')` in
  // `parseProgram`, unchanged below).
  searchNamespace(message = 'Expected namespace after search') {
    const token = this.peek()
    if (token.type === 'identifier' || (token.type === 'keyword' && token.lexeme === 'render')) {
      this.current += 1
      return token
    }
    throw new DslError(message, location(token))
  }

  parseProgram() {
    const ast = { kind: 'DslProgram', search: [], bindings: [], chains: [], render: null, loc: location(this.peek()) }
    if (this.match('search')) {
      do ast.search.push(this.searchNamespace().lexeme)
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
    while (this.match('.')) {
      if (this.atSubchain()) calls.push(this.parseSubchain())
      else if (this.peek().lexeme === 'write3d' && this.peek().type === 'identifier') calls.push(this.parseWrite3d())
      else calls.push(this.parseCall())
    }
    return { kind: 'Chain', calls, loc: first.loc }
  }

  // Port of upstream parseWriteCall for write3d: two positional references, a
  // volume and a geometry (`write3d(vol0, geo0)`), each an identifier or a surface.
  parseWrite3d() {
    const name = this.identifier()
    this.consume('(')
    const reference = () => {
      const token = this.peek()
      if (token.type === 'surface') return this.parseSurface()
      if (token.type !== 'identifier') throw new DslError('Expected surface reference', location(token))
      this.current += 1
      return { kind: 'identifier', name: token.lexeme, loc: location(token) }
    }
    const volume = reference()
    this.consume(',')
    const geometry = reference()
    this.consume(')')
    const args = [volume, geometry].map((value) => ({ name: null, value, loc: value.loc }))
    return { kind: 'Call', name: 'write3d', args, argMode: 'positional', loc: location(name) }
  }

  atSubchain() {
    return this.peek().type === 'keyword' && this.peek().lexeme === 'subchain'
  }

  isPunctuation(lexeme) {
    return this.peek().type === 'punctuation' && this.peek().lexeme === lexeme
  }

  // A chain in a value position (upstream parseChain in its 'expression' context).
  // It may hold subchain blocks, and it cannot hold write() or write3d().
  parseExpressionChain(first) {
    const calls = [first]
    while (this.isPunctuation('.')) {
      this.current += 1
      if (this.atSubchain()) {
        calls.push(this.parseSubchain())
        continue
      }
      const call = this.parseCall()
      // Upstream allows write() and write3d() only in statement context.
      if (call.name === 'write' || call.name === 'write3d') throw new DslError('Expected effect or IO function name', call.loc)
      calls.push(call)
    }
    return { kind: 'Chain', calls, loc: first.loc }
  }

  // Port of upstream parseSubchainCall: `subchain(name: "...", id: "...") { .a() .b() }`.
  // A single leading string is shorthand for `name`. Unknown keys, duplicate keys and
  // a missing ',' between keys are upstream warnings (P008-P010): the program still
  // compiles, an unknown key's value is discarded and the last duplicate wins. The
  // body holds one or more '.'-prefixed calls and cannot hold write(), write3d() or
  // another subchain, which upstream's lexer reserves as keywords.
  parseSubchain() {
    const start = this.tokens[this.current++]
    this.consume('(')
    const meta = { name: null, id: null }
    if (this.peek().type === 'string') {
      meta.name = this.tokens[this.current++].value
    } else {
      while (this.peek().type === 'identifier' && this.peek(1).lexeme === ':') {
        const key = this.identifier().lexeme
        this.consume(':')
        // A value that is not a string ends the arguments, so the closing ')'
        // check below reports it.
        if (this.peek().type !== 'string') break
        const value = this.tokens[this.current++].value
        if (key === 'name' || key === 'id') meta[key] = value
        this.match(',')
      }
    }
    this.consume(')')
    this.consume('{')
    // The body holds at least one element, so an empty block fails on its
    // missing '.'.
    const body = []
    do {
      this.consume('.')
      const call = this.parseCall()
      if (call.name === 'write' || call.name === 'write3d') throw new DslError('Expected effect or IO function name', call.loc)
      body.push(call)
    } while (!this.check('}'))
    this.consume('}')
    return { kind: 'Subchain', name: meta.name || null, id: meta.id || null, body, loc: location(start) }
  }

  parseCall() {
    const name = this.identifier('Expected effect or IO function name')
    this.consume('(')
    const args = []
    let mode = null
    // Upstream's parseCall lets the midi() and audio() value calls mix positional and
    // keyword arguments (`allowMixed`); every other call keeps one form.
    const allowMixed = name.lexeme === 'midi' || name.lexeme === 'audio'
    if (!this.check(')')) {
      do {
        const isNamed = this.peek().type === 'identifier' && this.peek(1).lexeme === ':'
        const nextMode = isNamed ? 'named' : 'positional'
        if (mode && mode !== nextMode && !allowMixed) throw new DslError('Cannot mix positional and named arguments', location(this.peek()))
        mode = mode && mode !== nextMode ? 'mixed' : nextMode
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
    const call = { kind: 'Call', name: name.lexeme, args, argMode: mode, loc: location(name) }
    return call.name === 'from' ? this.fromCall(call) : call
  }

  // Port of upstream transformFromInvocation: `from(namespace, effect(...))` is the
  // effect call, resolved in that one namespace instead of the search order. It
  // takes exactly two positional arguments, an identifier and one call; upstream's
  // read(), read3d(), osc(), midi() and audio() nodes are not Call nodes. Any
  // other from(...) stays a call named `from`, which no namespace defines, so the
  // compiler rejects it as an unknown effect.
  fromCall(call) {
    if (call.argMode !== 'positional' || call.args.length !== 2) return call
    const [namespace, target] = call.args.map((arg) => arg.value)
    const inner = target?.kind === 'Chain' && target.calls.length === 1 ? target.calls[0] : null
    if (namespace?.kind !== 'identifier' || inner?.kind !== 'Call' || ['read', 'read3d', 'write', 'write3d'].includes(inner.name)) {
      return call
    }
    return { ...inner, namespace: namespace.name }
  }

  parseValueExpression(minPrecedence = 0) {
    let left = this.parseValueUnary()
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 }
    while (this.peek().type === 'operator' && precedence[this.peek().lexeme] >= minPrecedence) {
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
      // `Math.PI` is the one numeric constant of upstream's grammar
      // (`NumberExpr ::= Number | 'Math.PI' | ...`).
      if (name === 'Math' && this.isPunctuation('.') && this.peek(1).type === 'identifier' && this.peek(1).lexeme === 'PI') {
        this.current += 2
        return Math.PI
      }
      // A one-argument `read3d(vol0)` names a volume or geometry for a parameter,
      // as upstream's validator reads it. With two arguments it starts a chain.
      if (name === 'read3d' && this.isPunctuation('(')) {
        this.current -= 1
        const call = this.parseCall()
        if (call.args.length === 1 && call.args[0].value?.kind === 'identifier') return call.args[0].value
        return this.parseExpressionChain(call)
      }
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
        // `read(oN).effect()` in a value position is a chain argument that starts
        // from the surface. A bare `read(oN)` stays a plain surface reference.
        if (this.isPunctuation('.')) {
          const read = { kind: 'Call', name: 'read', args: [{ name: null, value: surface, loc: surface.loc }], argMode: 'positional', loc: location(token) }
          return this.parseExpressionChain(read)
        }
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
      // `osc(...)`, `midi(...)` and `audio(...)` are the automation value calls of
      // upstream's parser; each parses as a regular call and the compiler turns it
      // into an Oscillator, Midi or Audio automation value.
      if ((name === 'osc' || name === 'midi' || name === 'audio') && this.peek().lexeme === '(') {
        this.current -= 1
        return this.parseCall()
      }
      // Any other call in a value position starts a chain argument
      // (upstream `Expr ::= Chain`), for example `tex: solid(color: #f00)`.
      if (this.isPunctuation('(')) {
        this.current -= 1
        return this.parseExpressionChain(this.parseCall())
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
