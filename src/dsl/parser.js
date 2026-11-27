import { DslError } from './error.js'
import { RANDOM_FUNCTIONS } from './random.js'
import { tokenizeDsl } from './tokenize.js'

const MAX_SEED = 4294967295

// Upstream's parser checks every midi() and audio() call where it is written
// (transformMidiInvocation, transformAudioInvocation), read or not.
const AUTOMATION_SIGNATURES = {
  midi: { order: ['channel', 'mode', 'min', 'max', 'sensitivity'], keywordOnly: ['name', 'id', 'cc', 'nrpn', 'zone', 'members'] },
  audio: { order: ['band', 'min', 'max'], keywordOnly: ['channel', 'name', 'id'] },
}

function checkAutomationCall(call) {
  const { order, keywordOnly } = AUTOMATION_SIGNATURES[call.name]
  const fail = (message) => { throw new DslError(`${call.name}() ${message}`, call.loc) }
  const positional = call.args.filter((arg) => arg.name === null)
  if (positional.length > order.length) fail(`${keywordOnly.join(', ').replace(/, ([^,]*)$/, ' and $1')} are keyword-only`)
  const named = new Map(call.args.filter((arg) => arg.name !== null).map((arg) => [arg.name, arg.value]))
  const valid = [...order, ...keywordOnly]
  for (const name of named.keys()) if (!valid.includes(name)) fail(`unknown parameter '${name}'. Valid: ${valid.join(', ')}`)
  const free = order.filter((name) => !named.has(name))
  if (positional.length > free.length) fail('has an excess positional argument')
  const given = new Set([...named.keys(), ...free.slice(0, positional.length)])
  if (call.name === 'midi') {
    if (!given.has('channel') && !named.has('zone')) fail("requires 'channel' or 'zone' argument")
    if (given.has('channel') && named.has('zone')) fail("'channel' and 'zone' are mutually exclusive")
    if (named.has('members') && !named.has('zone')) fail("'members' requires 'zone'")
  } else if (!given.has('band')) fail("requires 'band' argument")
  if (named.has('id') && !named.has('name')) fail("'id' requires readable 'name'")
  if (call.name === 'audio' && named.has('name') && !named.has('channel')) fail("selected device requires both 'name' and 'channel'")
  for (const name of ['name', 'id']) {
    if (!named.has(name)) continue
    if (typeof named.get(name) !== 'string') fail(`'${name}' requires a quoted string`)
    if (named.get(name).length === 0) fail(`'${name}' must not be empty`)
  }
}

function location(token) {
  return { sourceName: token.sourceName, line: token.line, column: token.column, index: token.index }
}

function parseColor(lexeme) {
  let hex = lexeme.slice(1)
  if (hex.length === 3) hex = [...hex].map((char) => char + char).join('')
  const values = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  if (hex.length === 8) values.push(Number.parseInt(hex.slice(6, 8), 16) / 255)
  // Keep the public array representation while distinguishing a hex colour
  // from an array literal when binding scalar r/g/b parameters.
  Object.defineProperty(values, 'kind', { value: 'color' })
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
    const ast = { kind: 'DslProgram', search: [], seed: null, bindings: [], chains: [], parts: [], render: null, loc: location(this.peek()) }
    if (this.match('search')) {
      do ast.search.push(this.searchNamespace().lexeme)
      while (this.match(','))
      this.match(';')
    }
    while (!this.atEnd()) {
      if (this.match(';')) continue
      if (this.atSeedDirective()) {
        this.parseSeedDirective(ast)
        continue
      }
      // Upstream: `part <name> {` declares a part, at the top level only.
      if (this.atPartDecl()) {
        const part = this.parsePartDecl()
        Object.defineProperty(part, 'planIndex', { value: ast.chains.length, enumerable: false, writable: true, configurable: true })
        ast.parts.push(part)
        continue
      }
      if (this.atMaybe() && !this.maybeBodyIsTail()) {
        ast.chains.push(this.parseMaybeStatement())
        this.match(';')
        continue
      }
      if (this.atControlFlow()) {
        ast.chains.push(this.parseControlFlow())
        this.match(';')
        continue
      }
      if (this.match('let')) {
        const binding = this.parseBinding(this.previous())
        // Upstream 9cc041d0: statement order matters. A let's planIndex is the
        // number of chain statements written before it; a chain sees only the
        // lets declared at or before its own index. Non-enumerable so the AST
        // shape (and its JSON form) stays unchanged.
        Object.defineProperty(binding, 'planIndex', { value: ast.chains.length, enumerable: false, writable: true, configurable: true })
        ast.bindings.push(binding)
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

  // Upstream: `seed` begins the seed directive only where a statement could not
  // begin. A call (`seed(`) or a chain (`seed.`) is not a directive.
  atSeedDirective() {
    const token = this.peek()
    if (token.type !== 'identifier' || token.lexeme !== 'seed') return false
    const next = this.peek(1)
    return !(next.type === 'punctuation' && (next.lexeme === '(' || next.lexeme === '.'))
  }

  // Upstream parseSeedDirective: `seed <uint32>`, once, after the search
  // directive and before every statement.
  parseSeedDirective(ast) {
    const start = this.tokens[this.current++]
    if (ast.seed) throw new DslError('Only one seed directive is allowed per program', location(start))
    if (ast.chains.length || ast.bindings.length || ast.render) {
      throw new DslError("'seed' directive must appear before other statements", location(start))
    }
    if (ast.search.length === 0) throw new DslError("'seed' directive must follow the search directive", location(start))
    const value = this.peek()
    if (value.type !== 'number' || !/^[0-9]+$/.test(value.lexeme) || Number(value.lexeme) > MAX_SEED) {
      throw new DslError('The seed must be a whole number from 0 to 4294967295', location(value))
    }
    this.current += 1
    ast.seed = { value: Number(value.lexeme), loc: location(start) }
    while (this.match(';')) continue
  }

  parseBinding(start) {
    const name = this.identifier('Expected binding name after let')
    this.consume('=')
    let value
    // A random call starts a value, which arithmetic may follow.
    const randomStart = RANDOM_FUNCTIONS.has(this.peek().lexeme)
    if (this.peek().type === 'identifier' && this.peek(1).lexeme === '(' && !randomStart) {
      value = this.toUse(this.parseCall())
      // A use on its own is a one-element chain, as upstream holds it.
      if (value.kind === 'Use' && !this.isPunctuation('.')) value = { kind: 'Chain', calls: [value], loc: value.loc }
      if (value.name === 'midi' || value.name === 'audio') checkAutomationCall(value)
      // A let's call continues across '.', as upstream parses its value as a chain.
      if (this.isPunctuation('.')) {
        value = this.parseExpressionChain(value)
      }
    } else value = this.parseValueExpression()
    this.match(';')
    return { kind: 'Binding', name: name.lexeme, value, loc: location(start) }
  }

  parseChain() {
    const first = this.toUse(this.parseCall())
    const calls = [first, ...this.parseChainTail()]
    return { kind: 'Chain', calls, loc: first.loc }
  }

  // `part` and `maybe` are not keywords: `part <name> {` and `maybe(` begin
  // these forms only where nothing else can (upstream isPartDeclStart, isMaybeStart).
  atPartDecl() {
    return this.peek().type === 'identifier' && this.peek().lexeme === 'part' &&
      this.peek(1).type === 'identifier' && this.peek(2).type === 'punctuation' && this.peek(2).lexeme === '{'
  }

  atMaybe(offset = 0) {
    return this.peek(offset).type === 'identifier' && this.peek(offset).lexeme === 'maybe' &&
      this.peek(offset + 1).type === 'punctuation' && this.peek(offset + 1).lexeme === '('
  }

  // Whether the block after `maybe(...)` is a chain tail: its first token is '.'.
  maybeBodyIsTail(offset = 0) {
    let index = this.current + offset + 1
    let depth = 0
    for (; index < this.tokens.length; index += 1) {
      const token = this.tokens[index]
      if (token.type === 'punctuation' && token.lexeme === '(') depth += 1
      else if (token.type === 'punctuation' && token.lexeme === ')' && --depth === 0) break
    }
    const open = this.tokens[index + 1]
    const first = this.tokens[index + 2]
    return open?.type === 'punctuation' && open.lexeme === '{' && first?.type === 'punctuation' && first.lexeme === '.'
  }

  // `use(part, name: value, ...)` (upstream toUse): one part, or pick() of parts.
  toUse(call) {
    if (call.kind !== 'Call' || call.name !== 'use') return call
    const positional = call.args.filter((arg) => arg.name === null)
    if (positional.length !== 1) {
      throw new DslError('use() takes one part, and its other arguments by name', call.loc)
    }
    return { kind: 'Use', target: positional[0].value, args: call.args.filter((arg) => arg.name !== null), loc: call.loc }
  }

  // The '.' elements and maybe tails that continue a chain.
  parseChainTail() {
    const calls = []
    while (true) {
      if (this.atMaybe() && this.maybeBodyIsTail()) {
        calls.push(this.parseMaybeTail())
        continue
      }
      if (!this.isPunctuation('.')) break
      this.current += 1
      if (this.atSubchain()) calls.push(this.parseSubchain())
      else if (this.peek().lexeme === 'write3d' && this.peek().type === 'identifier') calls.push(this.parseWrite3d())
      else if (this.atMaybe()) calls.push(this.parseMaybeTail())
      else calls.push(this.toUse(this.parseCall()))
    }
    return calls
  }

  parseMaybeProbability() {
    const start = this.tokens[this.current++]
    this.consume('(')
    const probability = this.parseValueExpression()
    this.consume(')')
    return { start, probability }
  }

  parseMaybeTail() {
    const { start, probability } = this.parseMaybeProbability()
    this.consume('{')
    const body = this.parseChainTail()
    this.consume('}')
    return { kind: 'MaybeTail', probability, body, loc: location(start) }
  }

  // `maybe(p) { statements }`: lets, chains, uses and nested maybes.
  parseMaybeStatement() {
    const { start, probability } = this.parseMaybeProbability()
    return { kind: 'Maybe', probability, body: this.parseBlock(false), loc: location(start) }
  }

  // A block's statements in order. A part body may also hold chain fragments.
  parseBlock(part) {
    this.consume('{')
    const body = []
    while (!this.check('}')) {
      if (this.atEnd()) throw new DslError("Expect '}'", location(this.peek()))
      if (this.match(';')) continue
      if (part && (this.isPunctuation('.') || (this.atMaybe() && this.maybeBodyIsTail()))) {
        const start = this.peek()
        body.push({ kind: 'ChainTail', calls: this.parseChainTail(), loc: location(start) })
      } else if (this.atMaybe() && !this.maybeBodyIsTail()) {
        body.push(this.parseMaybeStatement())
      } else if (this.atControlFlow()) {
        body.push(this.parseControlFlow())
      } else if (this.match('let')) {
        body.push(this.parseBinding(this.previous()))
      } else {
        body.push(this.parseChain())
      }
      this.match(';')
    }
    this.consume('}')
    return body
  }

  // Upstream's control flow: `if (c) { } elif (c) { } else { }`, `break`,
  // `continue` and `return [value]`. Upstream reserves these names.
  atControlFlow() {
    const token = this.peek()
    return token.type === 'keyword' && ['if', 'break', 'continue', 'return'].includes(token.lexeme)
  }

  parseCondition() {
    this.consume('(')
    const condition = this.parseValueExpression()
    this.consume(')')
    return condition
  }

  parseControlFlow() {
    const start = this.tokens[this.current++]
    const loc = location(start)
    if (start.lexeme === 'break') return { kind: 'Break', loc }
    if (start.lexeme === 'continue') return { kind: 'Continue', loc }
    if (start.lexeme === 'return') {
      // A value follows only where an expression can start (upstream
      // exprStartTokens): not at a keyword other than true and false.
      const next = this.peek()
      const ends = this.atEnd() || this.check('}') || this.check(';') ||
        (next.type === 'keyword' && next.lexeme !== 'true' && next.lexeme !== 'false')
      return ends ? { kind: 'Return', loc } : { kind: 'Return', value: this.parseValueExpression(), loc }
    }
    const condition = this.parseCondition()
    const then = this.parseBlock(false)
    const elif = []
    while (this.peek().type === 'keyword' && this.peek().lexeme === 'elif') {
      this.current += 1
      const branchCondition = this.parseCondition()
      elif.push({ condition: branchCondition, then: this.parseBlock(false) })
    }
    let otherwise = null
    if (this.peek().type === 'keyword' && this.peek().lexeme === 'else') {
      this.current += 1
      otherwise = this.parseBlock(false)
    }
    return { kind: 'If', condition, then, elif, else: otherwise, loc }
  }

  parsePartDecl() {
    const start = this.tokens[this.current++]
    const name = this.identifier().lexeme
    return { kind: 'PartDecl', name, body: this.parseBlock(true), loc: location(start) }
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
    const args = [volume, geometry].map((value) => ({ name: null, value, loc: value.loc }))
    this.parseIoElementId(args)
    this.consume(')')
    return { kind: 'Call', name: 'write3d', args, argMode: 'positional', loc: location(name) }
  }

  // Built-in I/O accepts one metadata keyword after its positional targets.
  // An ordinary effect call still requires either positionals or keywords.
  parseIoElementId(args) {
    if (!this.check(',') || this.peek(1).type !== 'identifier' || this.peek(1).lexeme !== '_id' ||
        this.peek(2).type !== 'punctuation' || this.peek(2).lexeme !== ':') return false
    this.current += 3
    const start = this.peek()
    args.push({ name: '_id', value: this.parseValueExpression(), loc: location(start) })
    return true
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
      calls.push(this.toUse(call))
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
    // keyword arguments (`allowMixed`), and a random call takes positional bounds
    // beside named ones and its own `seed:`; every other call keeps one form.
    const allowMixed = name.lexeme === 'midi' || name.lexeme === 'audio' || name.lexeme === 'use' || RANDOM_FUNCTIONS.has(name.lexeme)
    if (!this.check(')')) {
      do {
        const isNamed = this.peek().type === 'identifier' && this.peek(1).lexeme === ':'
        if (name.lexeme === 'write' && isNamed && this.peek().lexeme === '_id') {
          throw new DslError('write() requires a positional surface before _id', location(this.peek()))
        }
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
        if (mode === 'positional' && name.lexeme === 'write') {
          this.parseIoElementId(args)
          break
        }
        if (mode === 'positional' && (name.lexeme === 'read' || name.lexeme === 'read3d') && this.parseIoElementId(args)) {
          this.match(',')
          break
        }
      } while (this.match(',') && !this.check(')'))
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
        while (this.match(',') && !this.check(']'))
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
      if ((name === 'read' || name === 'read3d') && this.isPunctuation('(')) {
        this.current -= 1
        const call = this.parseCall()
        if (this.isPunctuation('.')) return this.parseExpressionChain(call)
        const targets = call.args.filter(arg => arg.name !== '_id' && arg.name !== '_skip')
        if (name === 'read3d') {
          if (targets.length === 1 && targets[0].value?.kind === 'identifier') return targets[0].value
          return this.parseExpressionChain(call)
        }
        if (targets.length !== 1 || targets[0].value?.kind !== 'surface') {
          throw new DslError('Expected surface reference', call.loc)
        }
        if (targets[0].name !== null && !['surface', 'tex'].includes(targets[0].name)) {
          throw new DslError('read() surface argument must be named "surface" or "tex"', targets[0].loc)
        }
        return targets[0].value
      }
      if (['vec2', 'vec3', 'vec4'].includes(name) && this.match('(')) {
        const values = []
        if (!this.check(')')) {
          do values.push(this.parseValueExpression())
          while (this.match(',') && !this.check(')'))
        }
        this.consume(')')
        return { kind: 'vector', width: Number(name.at(-1)), values, loc: location(token) }
      }
      // Oscillators are offline values, and random calls resolve when the
      // program compiles. Parse MIDI/audio calls only so the compiler can warn
      // and ignore these unsupported real-time inputs.
      if ((name === 'osc' || name === 'midi' || name === 'audio' || RANDOM_FUNCTIONS.has(name)) && this.isPunctuation('(')) {
        this.current -= 1
        const call = this.parseCall()
        if (name === 'midi' || name === 'audio') checkAutomationCall(call)
        return call
      }
      // Any other call in a value position starts a chain argument
      // (upstream `Expr ::= Chain`), for example `tex: solid(color: #f00)`.
      if (this.isPunctuation('(')) {
        this.current -= 1
        return this.parseExpressionChain(this.parseCall())
      }
      let path = name
      // A member segment may be a keyword, as upstream's memberTokenTypes allows.
      while (this.match('.')) {
        const member = this.peek()
        // Upstream's memberTokenTypes: identifiers, output references and
        // every keyword but search.
        const accepted = member.type === 'identifier' || member.type === 'surface' || (member.type === 'keyword' && member.lexeme !== 'search')
        if (!accepted) throw new DslError('Expected enum member', location(member))
        this.current += 1
        path += `.${member.lexeme}`
      }
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
