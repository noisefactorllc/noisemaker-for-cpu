import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDsl } from '../src/dsl/parser.js'
import { compileDsl } from '../src/dsl/compiler.js'
import { createDefaultRegistry } from '../src/effects/catalog.js'

const registry = await createDefaultRegistry()
const prefix = 'search synth, filter\nseed 3\nnoise().write(o0)\n'

for (const call of ['write(o1)', 'write3d(vol0, geo0)']) {
  test(`return cannot consume standalone ${call} as its value`, () => {
    const source = `${prefix}return\n${call}\nrender(o0)`
    assert.throws(() => parseDsl(source), (error) => {
      assert.equal(error.name, 'DslError')
      assert.equal(error.line, 5)
      assert.equal(error.column, 1)
      return true
    })
  })
}

for (const comment of ['// boundary', '/* boundary */']) {
  for (const branch of ['else', 'elif (1)']) {
    test(`${comment} separates ${branch} from the preceding if`, () => {
      const source = `${prefix}if (1) {\nnoise().write(o1)\n}\n${comment}\n${branch} {\nnoise().write(o2)\n}\nrender(o0)`
      assert.throws(() => parseDsl(source), (error) => {
        assert.equal(error.name, 'DslError')
        assert.equal(error.line, 8)
        assert.equal(error.column, 1)
        return true
      })
    })
  }
}

test('a comment after return leaves the following chain as a statement', () => {
  const source = `${prefix}return\n// next statement\nnoise().write(o1)\nrender(o0)`
  const ast = parseDsl(source)
  assert.equal(ast.chains[1].kind, 'Return')
  assert.equal(Object.hasOwn(ast.chains[1], 'value'), false)
  assert.equal(ast.chains[2].kind, 'Chain')
  assert.equal(ast.chains[2].calls.at(-1).name, 'write')
  assert.doesNotThrow(() => compileDsl(source, registry))
})

test('attached branches accept comments inside their blocks', () => {
  const source = `${prefix}if (1) {\n// body\nnoise().write(o1)\n/* trailing */\n} elif (0) {\nnoise().write(o2)\n} else {\nnoise().write(o3)\n}\nrender(o0)`
  const branch = parseDsl(source).chains[1]
  assert.equal(branch.kind, 'If')
  assert.equal(branch.elif.length, 1)
  assert.equal(branch.else.length, 1)
  assert.doesNotThrow(() => compileDsl(source, registry))
})

test('ordinary leading, argument and chain comments preserve chained writes', () => {
  const source = '// leading\nsearch synth, filter\nnoise(/* argument */ scaleX: 3)\n// before dot\n. /* after dot */ tint().write(o0, _id: "out")\nrender(o0)\n// trailing'
  const calls = parseDsl(source).chains[0].calls
  assert.deepEqual(calls.map(call => call.name), ['noise', 'tint', 'write'])
  assert.doesNotThrow(() => compileDsl(source, registry))
})

test('write3d remains valid in a statement chain', () => {
  const ast = parseDsl('search synth\nread3d(vol0, geo0).write3d(vol0, geo0)')
  assert.deepEqual(ast.chains[0].calls.map(call => call.name), ['read3d', 'write3d'])
})
