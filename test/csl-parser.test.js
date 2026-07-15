import test from 'node:test'
import assert from 'node:assert/strict'

import { parseCsl } from '../src/csl/parser.js'

const SOURCE = `
uniform sampler2D inputTex;
uniform float amount = 0.5;

float pulse(float x) {
  return smoothstep(0.0, 1.0, x);
}

vec4 main() {
  vec4 color = texture(inputTex, uv);
  for (int i = 0; i < 2; i++) {
    color.rgb *= pulse(amount);
  }
  if (color.a > 0.0) {
    return color;
  } else {
    return vec4(0.0);
  }
}
`

test('CSL parser builds uniforms, functions, control flow, calls, and swizzles', () => {
  const ast = parseCsl(SOURCE, { sourceName: 'fixture.csl' })

  assert.equal(ast.kind, 'Program')
  assert.deepEqual(ast.uniforms.map(({ type, name }) => [type, name]), [
    ['sampler2D', 'inputTex'],
    ['float', 'amount'],
  ])
  assert.equal(ast.uniforms[1].initializer.value, 0.5)
  assert.deepEqual(ast.functions.map(({ returnType, name }) => [returnType, name]), [
    ['float', 'pulse'],
    ['vec4', 'main'],
  ])

  const main = ast.functions[1]
  assert.equal(main.body.statements[0].kind, 'VariableDeclaration')
  assert.equal(main.body.statements[1].kind, 'ForStatement')
  assert.equal(main.body.statements[2].kind, 'IfStatement')
  assert.equal(main.body.statements[1].body.statements[0].expression.left.property, 'rgb')
})

test('CSL parser observes arithmetic precedence and ternaries', () => {
  const ast = parseCsl('vec4 main() { float x = 1.0 + 2.0 * 3.0; return x > 3.0 ? vec4(x) : vec4(0.0); }')
  const [declaration, returned] = ast.functions[0].body.statements

  assert.equal(declaration.initializer.operator, '+')
  assert.equal(declaration.initializer.right.operator, '*')
  assert.equal(returned.argument.kind, 'ConditionalExpression')
})

test('CSL parser reports the precise token for invalid syntax', () => {
  assert.throws(
    () => parseCsl('vec4 main( { return vec4(0.0); }', { sourceName: 'bad.csl' }),
    /bad\.csl:1:12: Expected parameter type/,
  )
})
