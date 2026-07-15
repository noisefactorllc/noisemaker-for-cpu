import { typeWidth } from './types.js'

class EmitScope {
  constructor(parent = null, state = null) {
    this.parent = parent
    this.state = state ?? { next: 0 }
    this.names = new Map()
  }

  child() {
    return new EmitScope(this, this.state)
  }

  define(name, prefix = 'v') {
    const jsName = `$${prefix}${this.state.next++}_${name}`
    this.names.set(name, jsName)
    return jsName
  }

  resolve(name) {
    return this.names.get(name) ?? this.parent?.resolve(name) ?? null
  }
}

function q(value) {
  return JSON.stringify(value)
}

function indent(text, depth = 1) {
  const prefix = '  '.repeat(depth)
  return text.split('\n').map((line) => line ? prefix + line : line).join('\n')
}

export function generateKernelSource(ast, options = {}) {
  const maxLoops = options.maxLoopIterations ?? 4096
  if (!Number.isSafeInteger(maxLoops) || maxLoops <= 0 || maxLoops > 10_000_000) {
    throw new RangeError('maxLoopIterations must be a positive safe integer no greater than 10000000')
  }
  const root = new EmitScope()
  const globals = new Map([
    ['uv', '$ctx.uv'],
    ['fragCoord', '$ctx.fragCoord'],
    ['resolution', '$ctx.resolution'],
    ['time', '$ctx.time'],
    ['seed', '$ctx.seed'],
  ])
  const functionNames = new Map()
  for (const fn of ast.functions) functionNames.set(fn.name, root.define(fn.name, 'fn'))

  const emitExpression = (node, scope) => {
    switch (node.kind) {
      case 'Literal':
        return typeof node.value === 'number' ? `Math.fround(${q(node.value)})` : q(node.value)
      case 'Identifier':
        return scope.resolve(node.name) ?? globals.get(node.name)
      case 'UnaryExpression':
        return `$rt.unary(${q(node.operator)}, ${emitExpression(node.argument, scope)}, ${typeWidth(node.resolvedType)})`
      case 'UpdateExpression': {
        const target = emitLValue(node.argument, scope)
        if (target.kind !== 'identifier') throw new Error('CSL codegen only supports ++/-- on scalar identifiers')
        return node.prefix ? `${node.operator}${target.code}` : `${target.code}${node.operator}`
      }
      case 'BinaryExpression':
        if (node.operator === '&&' || node.operator === '||') {
          return `(${emitExpression(node.left, scope)} ${node.operator} ${emitExpression(node.right, scope)})`
        }
        if (node.operator === '/' && node.resolvedType === 'int') {
          return `$rt.intDivide(${emitExpression(node.left, scope)}, ${emitExpression(node.right, scope)})`
        }
        return `$rt.binary(${q(node.operator)}, ${emitExpression(node.left, scope)}, ${emitExpression(node.right, scope)}, ${typeWidth(node.resolvedType)})`
      case 'ConditionalExpression':
        return `(${emitExpression(node.test, scope)} ? ${emitExpression(node.consequent, scope)} : ${emitExpression(node.alternate, scope)})`
      case 'MemberExpression':
        return `$rt.swizzle(${emitExpression(node.object, scope)}, ${q(node.property)})`
      case 'IndexExpression':
        return `${emitExpression(node.object, scope)}[${emitExpression(node.index, scope)} | 0]`
      case 'AssignmentExpression':
        return emitAssignment(node, scope)
      case 'CallExpression': {
        const name = node.callee.name
        const args = node.arguments.map((argument) => emitExpression(argument, scope))
        if (node.callKind === 'constructor') {
          while (args.length < 4) args.push('undefined')
          return `$rt.construct(${typeWidth(node.resolvedType)}, ${args.slice(0, 4).join(', ')})`
        }
        if (node.callKind === 'cast') {
          if (name === 'bool') return `Boolean(${args[0]})`
          if (name === 'int') return `(${args[0]} < 0 ? Math.ceil(${args[0]}) : Math.floor(${args[0]}))`
          return `Math.fround(${args[0]})`
        }
        if (node.callKind === 'user') return `${functionNames.get(name)}(${args.join(', ')})`
        if (name === 'length') return `$rt.length(${args[0]}, ${typeWidth(node.arguments[0].resolvedType)})`
        if (name === 'normalize') return `$rt.normalize(${args[0]}, ${typeWidth(node.resolvedType)})`
        if (name === 'dot' || name === 'distance') {
          return `$rt.${name}(${args[0]}, ${args[1]}, ${typeWidth(node.arguments[0].resolvedType)})`
        }
        if (name === 'texture') return `$rt.texture(${args[0]}, ${args[1]})`
        if (name === 'textureSize') return `$rt.textureSize(${args[0]})`
        while (args.length < 3) args.push('undefined')
        return `$rt.componentWise(${q(name)}, ${args[0]}, ${args[1]}, ${args[2]}, ${typeWidth(node.resolvedType)})`
      }
      default:
        throw new Error(`Unsupported CSL expression in codegen: ${node.kind}`)
    }
  }

  const emitLValue = (node, scope) => {
    if (node.kind === 'Identifier') return { kind: 'identifier', code: scope.resolve(node.name) }
    if (node.kind === 'MemberExpression') {
      return { kind: 'swizzle', object: emitExpression(node.object, scope), property: node.property }
    }
    if (node.kind === 'IndexExpression') {
      return { kind: 'index', object: emitExpression(node.object, scope), index: emitExpression(node.index, scope) }
    }
    throw new Error(`Invalid CSL assignment target ${node.kind}`)
  }

  const emitAssignment = (node, scope) => {
    const target = emitLValue(node.left, scope)
    const right = emitExpression(node.right, scope)
    const baseOperator = node.operator === '=' ? null : node.operator[0]
    if (target.kind === 'identifier') {
      if (!baseOperator) return `(${target.code} = ${right})`
      if (baseOperator === '/' && node.resolvedType === 'int') return `(${target.code} = $rt.intDivide(${target.code}, ${right}))`
      return `(${target.code} = $rt.binary(${q(baseOperator)}, ${target.code}, ${right}, ${typeWidth(node.resolvedType)}))`
    }
    const current = target.kind === 'swizzle'
      ? `$rt.swizzle(${target.object}, ${q(target.property)})`
      : `${target.object}[${target.index} | 0]`
    const value = baseOperator
      ? baseOperator === '/' && node.resolvedType === 'int'
        ? `$rt.intDivide(${current}, ${right})`
        : `$rt.binary(${q(baseOperator)}, ${current}, ${right}, ${typeWidth(node.resolvedType)})`
      : right
    if (target.kind === 'swizzle') return `$rt.assignSwizzle(${target.object}, ${q(target.property)}, ${value})`
    return `$rt.assignIndex(${target.object}, ${target.index}, ${value})`
  }

  const defaultValue = (type) => typeWidth(type) === 1 ? (type === 'bool' ? 'false' : 'Math.fround(0)') : `$rt.construct(${typeWidth(type)}, 0, undefined, undefined, undefined)`

  const emitVariable = (statement, scope, trailingSemicolon = true) => {
    const name = scope.define(statement.name)
    const initializer = statement.initializer ? emitExpression(statement.initializer, scope) : defaultValue(statement.type)
    const copied = typeWidth(statement.type) > 1 ? `$rt.copy(${initializer}, ${typeWidth(statement.type)})` : initializer
    return `${statement.constant ? 'const' : 'let'} ${name} = ${copied}${trailingSemicolon ? ';' : ''}`
  }

  const emitStatement = (statement, scope) => {
    switch (statement.kind) {
      case 'BlockStatement': {
        const child = scope.child()
        return `{\n${indent(statement.statements.map((item) => emitStatement(item, child)).join('\n'))}\n}`
      }
      case 'VariableDeclaration':
        return emitVariable(statement, scope)
      case 'ExpressionStatement':
        return `${emitExpression(statement.expression, scope)};`
      case 'ReturnStatement':
        return statement.argument ? `return ${emitExpression(statement.argument, scope)};` : 'return;'
      case 'IfStatement': {
        const alternate = statement.alternate ? ` else ${emitStatement(statement.alternate, scope.child())}` : ''
        return `if (${emitExpression(statement.test, scope)}) ${emitStatement(statement.consequent, scope.child())}${alternate}`
      }
      case 'ForStatement': {
        const child = scope.child()
        const init = statement.init?.kind === 'VariableDeclaration'
          ? emitVariable(statement.init, child, false)
          : statement.init ? emitExpression(statement.init, child) : ''
        const test = statement.test ? emitExpression(statement.test, child) : 'true'
        const update = statement.update ? emitExpression(statement.update, child) : ''
        const guard = `if (++$loopCount > ${maxLoops}) throw new Error(${q(`CSL loop iteration limit exceeded (${maxLoops})`)});`
        const body = statement.body.kind === 'BlockStatement'
          ? statement.body.statements.map((item) => emitStatement(item, child)).join('\n')
          : emitStatement(statement.body, child)
        return `for (${init}; ${test}; ${update}) {\n${indent(`${guard}\n${body}`)}\n}`
      }
      case 'BreakStatement': return 'break;'
      case 'ContinueStatement': return 'continue;'
      default: throw new Error(`Unsupported CSL statement in codegen: ${statement.kind}`)
    }
  }

  const uniformLines = []
  for (const uniform of ast.uniforms) {
    const name = root.define(uniform.name, 'u')
    if (uniform.type === 'sampler2D') {
      uniformLines.push(`const ${name} = $textures[${q(uniform.name)}];`)
    } else {
      const fallback = uniform.initializer ? emitExpression(uniform.initializer, root) : defaultValue(uniform.type)
      uniformLines.push(`const ${name} = $uniforms[${q(uniform.name)}] === undefined ? ${fallback} : $uniforms[${q(uniform.name)}];`)
    }
  }

  const constantLines = ast.constants.map((constant) => {
    const name = root.define(constant.name, 'c')
    return `const ${name} = ${emitExpression(constant.initializer, root)};`
  })

  const functionLines = ast.functions.map((fn) => {
    const scope = root.child()
    const params = fn.params.map((param) => scope.define(param.name, 'p'))
    const copies = fn.params
      .map((param, index) => typeWidth(param.type) > 1 ? `${params[index]} = $rt.copy(${params[index]}, ${typeWidth(param.type)});` : '')
      .filter(Boolean)
    const body = fn.body.statements.map((statement) => emitStatement(statement, scope)).join('\n')
    return `function ${functionNames.get(fn.name)}(${params.join(', ')}) {\n${indent([...copies, body].filter(Boolean).join('\n'))}\n}`
  })

  const mainName = functionNames.get('main')
  return `function runPixel($ctx, $out) {
  const $rt = $runtime;
  $rt.beginPixel();
  const $uniforms = $ctx.uniforms || $empty;
  const $textures = $ctx.textures || $empty;
  let $loopCount = 0;
${indent([...uniformLines, ...constantLines, ...functionLines].join('\n'))}
  const $color = ${mainName}();
  $out[0] = Math.fround($color[0]);
  $out[1] = Math.fround($color[1]);
  $out[2] = Math.fround($color[2]);
  $out[3] = Math.fround($color[3]);
  return $out;
}`
}
