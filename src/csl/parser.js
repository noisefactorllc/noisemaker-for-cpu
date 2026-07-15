import { CslError } from './error.js'
import { tokenizeCsl } from './tokenize.js'

const TYPES = new Set(['void', 'bool', 'int', 'float', 'sampler2D', 'vec2', 'vec3', 'vec4'])
const ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=', '%='])
const PRECEDENCE = new Map([
  ['||', 1],
  ['&&', 2],
  ['|', 3],
  ['^', 4],
  ['&', 5],
  ['==', 6],
  ['!=', 6],
  ['<', 7],
  ['<=', 7],
  ['>', 7],
  ['>=', 7],
  ['<<', 8],
  ['>>', 8],
  ['+', 9],
  ['-', 9],
  ['*', 10],
  ['/', 10],
  ['%', 10],
])

function loc(token) {
  return {
    sourceName: token.sourceName,
    line: token.line,
    column: token.column,
    index: token.index,
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens
    this.current = 0
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.current + offset, this.tokens.length - 1)]
  }

  previous() {
    return this.tokens[this.current - 1]
  }

  atEnd() {
    return this.peek().type === 'eof'
  }

  check(lexeme) {
    return this.peek().lexeme === lexeme
  }

  match(...lexemes) {
    if (!lexemes.includes(this.peek().lexeme)) return false
    this.current += 1
    return true
  }

  consume(lexeme, message = `Expected ${JSON.stringify(lexeme)}`) {
    if (this.check(lexeme)) {
      this.current += 1
      return this.previous()
    }
    throw new CslError(message, loc(this.peek()))
  }

  consumeIdentifier(message = 'Expected identifier') {
    const token = this.peek()
    if (token.type !== 'identifier') throw new CslError(message, loc(token))
    this.current += 1
    return token
  }

  consumeType(message = 'Expected type') {
    const token = this.peek()
    if (!TYPES.has(token.lexeme)) throw new CslError(message, loc(token))
    this.current += 1
    return token
  }

  parseProgram() {
    const program = { kind: 'Program', uniforms: [], constants: [], functions: [], loc: loc(this.peek()) }
    while (!this.atEnd()) {
      if (this.match('uniform')) {
        program.uniforms.push(this.parseUniform(this.previous()))
        continue
      }
      if (this.match('const')) {
        program.constants.push(this.parseVariableDeclaration(this.previous(), true, true))
        continue
      }
      program.functions.push(this.parseFunction())
    }
    return program
  }

  parseUniform(start) {
    const type = this.consumeType('Expected uniform type')
    const name = this.consumeIdentifier('Expected uniform name')
    const initializer = this.match('=') ? this.parseExpression() : null
    this.consume(';')
    return { kind: 'UniformDeclaration', type: type.lexeme, name: name.lexeme, initializer, loc: loc(start) }
  }

  parseFunction() {
    const returnType = this.consumeType('Expected function return type')
    const name = this.consumeIdentifier('Expected function name')
    this.consume('(')
    const params = []
    if (!this.check(')')) {
      do {
        const type = this.consumeType('Expected parameter type')
        const paramName = this.consumeIdentifier('Expected parameter name')
        params.push({ kind: 'Parameter', type: type.lexeme, name: paramName.lexeme, loc: loc(type) })
      } while (this.match(','))
    }
    this.consume(')')
    const body = this.parseBlock()
    return { kind: 'FunctionDeclaration', returnType: returnType.lexeme, name: name.lexeme, params, body, loc: loc(returnType) }
  }

  parseBlock() {
    const start = this.consume('{')
    const statements = []
    while (!this.check('}') && !this.atEnd()) statements.push(this.parseStatement())
    this.consume('}', 'Expected "}" after block')
    return { kind: 'BlockStatement', statements, loc: loc(start) }
  }

  parseStatement() {
    if (this.check('{')) return this.parseBlock()
    if (this.match('if')) return this.parseIf(this.previous())
    if (this.match('for')) return this.parseFor(this.previous())
    if (this.match('return')) return this.parseReturn(this.previous())
    if (this.match('break')) {
      const start = this.previous()
      this.consume(';')
      return { kind: 'BreakStatement', loc: loc(start) }
    }
    if (this.match('continue')) {
      const start = this.previous()
      this.consume(';')
      return { kind: 'ContinueStatement', loc: loc(start) }
    }
    if (this.match('const')) return this.parseVariableDeclaration(this.previous(), true, true)
    if (TYPES.has(this.peek().lexeme) && this.peek(1).type === 'identifier') {
      return this.parseVariableDeclaration(this.peek(), false, true)
    }

    const expression = this.parseExpression()
    this.consume(';', 'Expected ";" after expression')
    return { kind: 'ExpressionStatement', expression, loc: expression.loc }
  }

  parseVariableDeclaration(start, constant, consumeSemicolon) {
    const type = this.consumeType('Expected variable type')
    const name = this.consumeIdentifier('Expected variable name')
    const initializer = this.match('=') ? this.parseExpression() : null
    if (consumeSemicolon) this.consume(';', 'Expected ";" after variable declaration')
    return {
      kind: 'VariableDeclaration',
      constant,
      type: type.lexeme,
      name: name.lexeme,
      initializer,
      loc: loc(start),
    }
  }

  parseIf(start) {
    this.consume('(')
    const test = this.parseExpression()
    this.consume(')')
    const consequent = this.parseStatement()
    const alternate = this.match('else') ? (this.match('if') ? this.parseIf(this.previous()) : this.parseStatement()) : null
    return { kind: 'IfStatement', test, consequent, alternate, loc: loc(start) }
  }

  parseFor(start) {
    this.consume('(')
    let init = null
    if (!this.check(';')) {
      if (this.match('const')) init = this.parseVariableDeclaration(this.previous(), true, false)
      else if (TYPES.has(this.peek().lexeme)) init = this.parseVariableDeclaration(this.peek(), false, false)
      else init = this.parseExpression()
    }
    this.consume(';')
    const test = this.check(';') ? null : this.parseExpression()
    this.consume(';')
    const update = this.check(')') ? null : this.parseExpression()
    this.consume(')')
    const body = this.parseStatement()
    return { kind: 'ForStatement', init, test, update, body, loc: loc(start) }
  }

  parseReturn(start) {
    const argument = this.check(';') ? null : this.parseExpression()
    this.consume(';')
    return { kind: 'ReturnStatement', argument, loc: loc(start) }
  }

  parseExpression() {
    return this.parseAssignment()
  }

  parseAssignment() {
    const left = this.parseConditional()
    if (!ASSIGNMENT_OPERATORS.has(this.peek().lexeme)) return left
    const operator = this.peek().lexeme
    this.current += 1
    const right = this.parseAssignment()
    return { kind: 'AssignmentExpression', operator, left, right, loc: left.loc }
  }

  parseConditional() {
    const test = this.parseBinary(1)
    if (!this.match('?')) return test
    const consequent = this.parseExpression()
    this.consume(':', 'Expected ":" in conditional expression')
    const alternate = this.parseAssignment()
    return { kind: 'ConditionalExpression', test, consequent, alternate, loc: test.loc }
  }

  parseBinary(minPrecedence) {
    let left = this.parseUnary()
    while (true) {
      const operator = this.peek().lexeme
      const precedence = PRECEDENCE.get(operator)
      if (precedence === undefined || precedence < minPrecedence) break
      this.current += 1
      const right = this.parseBinary(precedence + 1)
      left = { kind: 'BinaryExpression', operator, left, right, loc: left.loc }
    }
    return left
  }

  parseUnary() {
    if (this.match('!', '-', '+')) {
      const operator = this.previous()
      return { kind: 'UnaryExpression', operator: operator.lexeme, argument: this.parseUnary(), prefix: true, loc: loc(operator) }
    }
    if (this.match('++', '--')) {
      const operator = this.previous()
      return { kind: 'UpdateExpression', operator: operator.lexeme, argument: this.parseUnary(), prefix: true, loc: loc(operator) }
    }
    return this.parsePostfix()
  }

  parsePostfix() {
    let expression = this.parsePrimary()
    while (true) {
      if (this.match('(')) {
        const args = []
        if (!this.check(')')) {
          do args.push(this.parseExpression())
          while (this.match(','))
        }
        this.consume(')')
        expression = { kind: 'CallExpression', callee: expression, arguments: args, loc: expression.loc }
      } else if (this.match('.')) {
        const property = this.consumeIdentifier('Expected member name after "."')
        expression = { kind: 'MemberExpression', object: expression, property: property.lexeme, loc: expression.loc }
      } else if (this.match('[')) {
        const index = this.parseExpression()
        this.consume(']')
        expression = { kind: 'IndexExpression', object: expression, index, loc: expression.loc }
      } else if (this.match('++', '--')) {
        expression = {
          kind: 'UpdateExpression',
          operator: this.previous().lexeme,
          argument: expression,
          prefix: false,
          loc: expression.loc,
        }
      } else {
        break
      }
    }
    return expression
  }

  parsePrimary() {
    const token = this.peek()
    if (token.type === 'number') {
      this.current += 1
      return { kind: 'Literal', value: Number(token.lexeme), raw: token.lexeme, loc: loc(token) }
    }
    if (token.lexeme === 'true' || token.lexeme === 'false') {
      this.current += 1
      return { kind: 'Literal', value: token.lexeme === 'true', raw: token.lexeme, loc: loc(token) }
    }
    if (token.type === 'identifier' || TYPES.has(token.lexeme)) {
      this.current += 1
      return { kind: 'Identifier', name: token.lexeme, loc: loc(token) }
    }
    if (this.match('(')) {
      const expression = this.parseExpression()
      this.consume(')')
      return expression
    }
    throw new CslError('Expected expression', loc(token))
  }
}

export function parseCsl(source, options = {}) {
  return new Parser(tokenizeCsl(source, options)).parseProgram()
}
