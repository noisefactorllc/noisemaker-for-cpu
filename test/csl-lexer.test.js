import test from 'node:test'
import assert from 'node:assert/strict'

import { tokenizeCsl } from '../src/csl/tokenize.js'

test('CSL lexer tracks comments, numbers, operators, and source locations', () => {
  const tokens = tokenizeCsl(`// shader\nuniform float gain = .5e+1;\n/* x */ gain *= 2.0;`, { sourceName: 'fixture.csl' })
  const visible = tokens.filter((token) => token.type !== 'eof')

  assert.deepEqual(
    visible.map(({ type, lexeme, line, column }) => [type, lexeme, line, column]),
    [
      ['keyword', 'uniform', 2, 1],
      ['keyword', 'float', 2, 9],
      ['identifier', 'gain', 2, 15],
      ['operator', '=', 2, 20],
      ['number', '.5e+1', 2, 22],
      ['punctuation', ';', 2, 27],
      ['identifier', 'gain', 3, 9],
      ['operator', '*=', 3, 14],
      ['number', '2.0', 3, 17],
      ['punctuation', ';', 3, 20],
    ],
  )
})

test('CSL lexer rejects unknown and unterminated input with a source location', () => {
  assert.throws(() => tokenizeCsl('@', { sourceName: 'bad.csl' }), /bad\.csl:1:1: Unexpected character/)
  assert.throws(() => tokenizeCsl('/* nope', { sourceName: 'bad.csl' }), /bad\.csl:1:1: Unterminated block comment/)
})
