import test from 'node:test'
import assert from 'node:assert/strict'

import { CslRuntime } from '../src/csl/runtime.js'

test('CSL hot helpers avoid per-operation closure and argument-array allocation', () => {
  for (const name of ['unary', 'binary', 'componentWise']) {
    assert.doesNotMatch(CslRuntime.prototype[name].toString(), /=>/, `${name} must not create a local closure`)
  }
  assert.doesNotMatch(CslRuntime.prototype.construct.toString(), /\[a, b, c, d\]/, 'construct must not create an argument array')
})
