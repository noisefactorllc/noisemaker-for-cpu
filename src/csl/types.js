import { CslError } from './error.js'

const VECTOR_WIDTH = Object.freeze({ vec2: 2, vec3: 3, vec4: 4 })
const NUMERIC_TYPES = new Set(['int', 'float', 'vec2', 'vec3', 'vec4'])
const COMPONENT_BUILTINS = new Set([
  'abs', 'sin', 'cos', 'tan', 'asin', 'acos', 'floor', 'ceil', 'round', 'fract', 'sqrt', 'exp', 'log',
])
const MULTI_COMPONENT_BUILTINS = new Set(['min', 'max', 'mod', 'pow', 'clamp', 'mix', 'step', 'smoothstep'])

export function typeWidth(type) {
  return VECTOR_WIDTH[type] ?? 1
}

function vectorType(width) {
  return width === 1 ? 'float' : `vec${width}`
}

function isNumeric(type) {
  return NUMERIC_TYPES.has(type)
}

function isScalar(type) {
  return type === 'float' || type === 'int' || type === 'bool'
}

function isAssignable(target, source) {
  if (target === source) return true
  if (target === 'float' && source === 'int') return true
  return false
}

function compatibleNumeric(left, right, node) {
  if (!isNumeric(left) || !isNumeric(right)) {
    throw new CslError(`Operator requires numeric operands, received ${left} and ${right}`, node.loc)
  }
  const lw = typeWidth(left)
  const rw = typeWidth(right)
  if (lw !== 1 && rw !== 1 && lw !== rw) {
    throw new CslError(`Vector widths do not match: ${left} and ${right}`, node.loc)
  }
  return vectorType(Math.max(lw, rw))
}

class Scope {
  constructor(parent = null) {
    this.parent = parent
    this.bindings = new Map()
  }

  define(name, binding, location) {
    if (this.bindings.has(name)) throw new CslError(`Duplicate identifier "${name}"`, location)
    this.bindings.set(name, binding)
  }

  resolve(name) {
    return this.bindings.get(name) ?? this.parent?.resolve(name) ?? null
  }
}

function swizzleIndices(property) {
  const groups = ['xyzw', 'rgba', 'stpq']
  const group = groups.find((candidate) => [...property].every((char) => candidate.includes(char)))
  if (!group) return null
  return [...property].map((char) => group.indexOf(char))
}

function rootIdentifier(node) {
  let current = node
  while (current?.kind === 'MemberExpression' || current?.kind === 'IndexExpression') current = current.object
  return current?.kind === 'Identifier' ? current : null
}

function assertWritable(node) {
  if (!['Identifier', 'MemberExpression', 'IndexExpression'].includes(node.kind)) {
    throw new CslError('Assignment target must be a variable, vector component, or vector index', node.loc)
  }
  const root = rootIdentifier(node)
  if (!root) throw new CslError('Assignment target must originate from a variable', node.loc)
  if (root.binding?.constant) throw new CslError(`Cannot assign to constant "${root.name}"`, root.loc)
  if (node.kind === 'MemberExpression' && new Set(node.indices).size !== node.indices.length) {
    throw new CslError(`Cannot assign to swizzle with repeated components "${node.property}"`, node.loc)
  }
}

function alwaysReturns(statement) {
  switch (statement.kind) {
    case 'ReturnStatement':
      return true
    case 'BlockStatement':
      return statement.statements.some((child) => alwaysReturns(child))
    case 'IfStatement':
      return Boolean(statement.alternate) && alwaysReturns(statement.consequent) && alwaysReturns(statement.alternate)
    default:
      return false
  }
}

export function checkCsl(ast) {
  const globalScope = new Scope()
  const functions = new Map()
  const uniforms = new Map()

  for (const [name, type] of [
    ['uv', 'vec2'],
    ['fragCoord', 'vec2'],
    ['resolution', 'vec2'],
    ['time', 'float'],
    ['seed', 'float'],
  ]) {
    globalScope.define(name, { kind: 'builtin-global', type, constant: true }, ast.loc)
  }

  for (const uniform of ast.uniforms) {
    if (uniform.type === 'void') throw new CslError('Uniform type cannot be void', uniform.loc)
    const binding = { kind: 'uniform', type: uniform.type, constant: true, node: uniform }
    if (globalScope.bindings.get(uniform.name)?.kind === 'builtin-global') globalScope.bindings.set(uniform.name, binding)
    else globalScope.define(uniform.name, binding, uniform.loc)
    uniforms.set(uniform.name, binding)
  }

  for (const constant of ast.constants) {
    const binding = { kind: 'constant', type: constant.type, constant: true, node: constant }
    globalScope.define(constant.name, binding, constant.loc)
  }

  for (const fn of ast.functions) {
    if (functions.has(fn.name)) throw new CslError(`Duplicate function "${fn.name}"`, fn.loc)
    const signature = { kind: 'function', returnType: fn.returnType, params: fn.params.map((param) => param.type), node: fn }
    functions.set(fn.name, signature)
    globalScope.define(fn.name, signature, fn.loc)
  }

  const checkExpression = (node, scope) => {
    let type
    switch (node.kind) {
      case 'Literal':
        type = typeof node.value === 'boolean' ? 'bool' : /[.eE]/.test(node.raw) ? 'float' : 'int'
        break
      case 'Identifier': {
        const binding = scope.resolve(node.name)
        if (!binding || binding.kind === 'function') throw new CslError(`Unknown identifier "${node.name}"`, node.loc)
        node.binding = binding
        type = binding.type
        break
      }
      case 'UnaryExpression': {
        const argument = checkExpression(node.argument, scope)
        if (node.operator === '!') {
          if (argument !== 'bool') throw new CslError('Logical not requires bool', node.loc)
          type = 'bool'
        } else {
          if (!isNumeric(argument)) throw new CslError(`Unary ${node.operator} requires a numeric value`, node.loc)
          type = argument
        }
        break
      }
      case 'UpdateExpression': {
        const argument = checkExpression(node.argument, scope)
        assertWritable(node.argument)
        if (argument !== 'int' && argument !== 'float') throw new CslError(`${node.operator} requires a scalar variable`, node.loc)
        type = argument
        break
      }
      case 'BinaryExpression': {
        const left = checkExpression(node.left, scope)
        const right = checkExpression(node.right, scope)
        if (['&&', '||'].includes(node.operator)) {
          if (left !== 'bool' || right !== 'bool') throw new CslError(`${node.operator} requires bool operands`, node.loc)
          type = 'bool'
        } else if (['==', '!=', '<', '<=', '>', '>='].includes(node.operator)) {
          compatibleNumeric(left, right, node)
          if (!isScalar(left) || !isScalar(right)) throw new CslError('Vector comparisons are not supported in CSL v0.1', node.loc)
          type = 'bool'
        } else if (['&', '|', '^', '<<', '>>'].includes(node.operator)) {
          if (left !== 'int' || right !== 'int') throw new CslError(`${node.operator} requires int operands`, node.loc)
          type = 'int'
        } else {
          type = compatibleNumeric(left, right, node)
          if (type === 'float' && left === 'int' && right === 'int') type = 'int'
        }
        break
      }
      case 'ConditionalExpression': {
        const test = checkExpression(node.test, scope)
        if (test !== 'bool') throw new CslError('Conditional test must be bool', node.test.loc)
        const consequent = checkExpression(node.consequent, scope)
        const alternate = checkExpression(node.alternate, scope)
        if (consequent === alternate) type = consequent
        else if (isNumeric(consequent) && isNumeric(alternate)) type = compatibleNumeric(consequent, alternate, node)
        else throw new CslError(`Conditional branches do not match: ${consequent} and ${alternate}`, node.loc)
        break
      }
      case 'MemberExpression': {
        const objectType = checkExpression(node.object, scope)
        const width = typeWidth(objectType)
        if (width === 1) throw new CslError(`Cannot swizzle ${objectType}`, node.loc)
        const indices = swizzleIndices(node.property)
        if (!indices || indices.length < 1 || indices.length > 4 || indices.some((index) => index >= width)) {
          throw new CslError(`Invalid ${objectType} swizzle "${node.property}"`, node.loc)
        }
        node.indices = indices
        type = indices.length === 1 ? 'float' : vectorType(indices.length)
        break
      }
      case 'IndexExpression': {
        const objectType = checkExpression(node.object, scope)
        const indexType = checkExpression(node.index, scope)
        if (typeWidth(objectType) === 1 || indexType !== 'int') throw new CslError('Vector indexing requires an int index', node.loc)
        type = 'float'
        break
      }
      case 'CallExpression': {
        if (node.callee.kind !== 'Identifier') throw new CslError('CSL calls require a named function', node.loc)
        const name = node.callee.name
        const argTypes = node.arguments.map((argument) => checkExpression(argument, scope))
        if (VECTOR_WIDTH[name]) {
          const width = VECTOR_WIDTH[name]
          const components = argTypes.reduce((total, argType) => total + typeWidth(argType), 0)
          if (!(argTypes.length === 1 && isScalar(argTypes[0])) && components !== width) {
            throw new CslError(`${name} requires one scalar or ${width} total components`, node.loc)
          }
          if (argTypes.some((argType) => !isNumeric(argType))) throw new CslError(`${name} arguments must be numeric`, node.loc)
          node.callKind = 'constructor'
          type = name
          break
        }
        if (name === 'float' || name === 'int' || name === 'bool') {
          if (argTypes.length !== 1 || !isScalar(argTypes[0])) throw new CslError(`${name} requires one scalar`, node.loc)
          node.callKind = 'cast'
          type = name
          break
        }
        if (COMPONENT_BUILTINS.has(name)) {
          if (argTypes.length !== 1 || !isNumeric(argTypes[0])) throw new CslError(`${name} requires one numeric argument`, node.loc)
          node.callKind = 'builtin'
          type = argTypes[0] === 'int' ? 'float' : argTypes[0]
          break
        }
        if (MULTI_COMPONENT_BUILTINS.has(name)) {
          const expected = ['clamp', 'mix', 'smoothstep'].includes(name) ? 3 : 2
          if (argTypes.length !== expected) throw new CslError(`${name} requires ${expected} arguments`, node.loc)
          type = argTypes.reduce((result, argType) => compatibleNumeric(result, argType, node))
          node.callKind = 'builtin'
          break
        }
        if (name === 'atan') {
          if (argTypes.length < 1 || argTypes.length > 2) throw new CslError('atan requires one or two arguments', node.loc)
          type = argTypes.reduce((result, argType) => compatibleNumeric(result, argType, node))
          node.callKind = 'builtin'
          break
        }
        if (name === 'length') {
          if (argTypes.length !== 1 || !isNumeric(argTypes[0])) throw new CslError('length requires one numeric argument', node.loc)
          node.callKind = 'builtin'
          type = 'float'
          break
        }
        if (name === 'normalize') {
          if (argTypes.length !== 1 || typeWidth(argTypes[0]) === 1) throw new CslError('normalize requires a vector', node.loc)
          node.callKind = 'builtin'
          type = argTypes[0]
          break
        }
        if (name === 'dot' || name === 'distance') {
          if (argTypes.length !== 2 || typeWidth(argTypes[0]) === 1 || argTypes[0] !== argTypes[1]) {
            throw new CslError(`${name} requires two vectors of the same type`, node.loc)
          }
          node.callKind = 'builtin'
          type = 'float'
          break
        }
        if (name === 'texture') {
          if (argTypes.length !== 2 || argTypes[0] !== 'sampler2D' || argTypes[1] !== 'vec2') {
            throw new CslError('texture requires (sampler2D, vec2)', node.loc)
          }
          node.callKind = 'builtin'
          type = 'vec4'
          break
        }
        if (name === 'textureSize') {
          if (argTypes.length < 1 || argTypes.length > 2 || argTypes[0] !== 'sampler2D') {
            throw new CslError('textureSize requires sampler2D and optional level', node.loc)
          }
          node.callKind = 'builtin'
          type = 'vec2'
          break
        }
        const fn = functions.get(name)
        if (!fn) throw new CslError(`Unknown function "${name}"`, node.loc)
        if (argTypes.length !== fn.params.length) throw new CslError(`${name} requires ${fn.params.length} arguments`, node.loc)
        for (let i = 0; i < argTypes.length; i += 1) {
          if (!isAssignable(fn.params[i], argTypes[i])) {
            throw new CslError(`Argument ${i + 1} of ${name} requires ${fn.params[i]}, received ${argTypes[i]}`, node.arguments[i].loc)
          }
        }
        node.callKind = 'user'
        node.signature = fn
        type = fn.returnType
        break
      }
      case 'AssignmentExpression': {
        const left = checkExpression(node.left, scope)
        const right = checkExpression(node.right, scope)
        assertWritable(node.left)
        if (node.operator === '=') {
          if (!isAssignable(left, right)) throw new CslError(`Cannot assign ${right} to ${left}`, node.loc)
        } else {
          const result = compatibleNumeric(left, right, node)
          if (typeWidth(result) !== typeWidth(left)) throw new CslError(`Compound assignment result ${result} does not fit ${left}`, node.loc)
        }
        type = left
        break
      }
      default:
        throw new CslError(`Unsupported expression ${node.kind}`, node.loc)
    }
    node.resolvedType = type
    return type
  }

  const checkStatement = (statement, scope, returnType, loopDepth = 0) => {
    switch (statement.kind) {
      case 'BlockStatement': {
        const blockScope = new Scope(scope)
        for (const child of statement.statements) checkStatement(child, blockScope, returnType, loopDepth)
        break
      }
      case 'VariableDeclaration': {
        if (statement.type === 'void' || statement.type === 'sampler2D') throw new CslError(`Invalid local type ${statement.type}`, statement.loc)
        if (statement.initializer) {
          const initializer = checkExpression(statement.initializer, scope)
          if (!isAssignable(statement.type, initializer)) {
            throw new CslError(`Cannot initialize ${statement.type} with ${initializer}`, statement.loc)
          }
        }
        const binding = { kind: 'local', type: statement.type, constant: statement.constant, node: statement }
        statement.binding = binding
        scope.define(statement.name, binding, statement.loc)
        break
      }
      case 'ExpressionStatement':
        checkExpression(statement.expression, scope)
        break
      case 'IfStatement':
        if (checkExpression(statement.test, scope) !== 'bool') throw new CslError('if test must be bool', statement.test.loc)
        checkStatement(statement.consequent, new Scope(scope), returnType, loopDepth)
        if (statement.alternate) checkStatement(statement.alternate, new Scope(scope), returnType, loopDepth)
        break
      case 'ForStatement': {
        const forScope = new Scope(scope)
        if (statement.init?.kind === 'VariableDeclaration') checkStatement(statement.init, forScope, returnType, loopDepth)
        else if (statement.init) checkExpression(statement.init, forScope)
        if (statement.test && checkExpression(statement.test, forScope) !== 'bool') throw new CslError('for test must be bool', statement.test.loc)
        if (statement.update) checkExpression(statement.update, forScope)
        checkStatement(statement.body, forScope, returnType, loopDepth + 1)
        break
      }
      case 'ReturnStatement': {
        if (returnType === 'void' && statement.argument) throw new CslError('void function cannot return a value', statement.loc)
        if (returnType !== 'void' && !statement.argument) throw new CslError(`${returnType} function must return a value`, statement.loc)
        if (statement.argument) {
          const actual = checkExpression(statement.argument, scope)
          if (!isAssignable(returnType, actual)) throw new CslError(`Cannot return ${actual} from ${returnType} function`, statement.loc)
        }
        break
      }
      case 'BreakStatement':
      case 'ContinueStatement':
        if (loopDepth === 0) throw new CslError(`${statement.kind === 'BreakStatement' ? 'break' : 'continue'} used outside a loop`, statement.loc)
        break
      default:
        throw new CslError(`Unsupported statement ${statement.kind}`, statement.loc)
    }
  }

  for (const uniform of ast.uniforms) {
    if (uniform.initializer) {
      const actual = checkExpression(uniform.initializer, globalScope)
      if (!isAssignable(uniform.type, actual)) throw new CslError(`Cannot initialize ${uniform.type} uniform with ${actual}`, uniform.loc)
    }
  }

  for (const constant of ast.constants) {
    if (!constant.initializer) throw new CslError(`Constant "${constant.name}" requires an initializer`, constant.loc)
    const actual = checkExpression(constant.initializer, globalScope)
    if (!isAssignable(constant.type, actual)) throw new CslError(`Cannot initialize ${constant.type} constant with ${actual}`, constant.loc)
  }

  for (const fn of ast.functions) {
    const scope = new Scope(globalScope)
    for (const param of fn.params) {
      const binding = { kind: 'parameter', type: param.type, constant: false, node: param }
      param.binding = binding
      scope.define(param.name, binding, param.loc)
    }
    for (const statement of fn.body.statements) checkStatement(statement, scope, fn.returnType)
    if (fn.returnType !== 'void' && !alwaysReturns(fn.body)) {
      throw new CslError(`Function "${fn.name}" must return ${fn.returnType} on every path`, fn.loc)
    }
  }

  const main = functions.get('main')
  if (!main) throw new CslError('CSL program requires vec4 main()', ast.loc)
  if (main.returnType !== 'vec4') throw new CslError('main must return vec4', main.node.loc)
  if (main.params.length !== 0) throw new CslError('main must not declare parameters', main.node.loc)

  ast.typed = true
  ast.uniformMap = uniforms
  ast.functionMap = functions
  return ast
}
