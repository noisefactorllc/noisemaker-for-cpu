// The draw library against upstream's golden vectors. The copy in
// test/fixtures/seeded-draws.json is byte-identical to upstream's file at the
// commit that test/fixtures/seeded-draws.source.json records.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import {
  chanceFrom, colorComponentDraw, drawU32, fnv1a32, joinKey, mix32, pickIndex, pinSeed,
  randColorFrom, randFrom, randIntFrom, unmix32,
} from '../src/dsl/draws.js'

const fixture = new URL('./fixtures/seeded-draws.json', import.meta.url)
const bytes = readFileSync(fixture)
const vectors = JSON.parse(bytes)
const source = JSON.parse(readFileSync(new URL('./fixtures/seeded-draws.source.json', import.meta.url), 'utf8'))

test('the golden vectors are the upstream file the source record names', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256)
  assert.match(source.commit, /^[0-9a-f]{40}$/)
  assert.equal(source.branch, '2.x')
  assert.equal(vectors.format, 1)
})

test('mix32, unmix32 and fnv1a32 match every vector', () => {
  for (const entry of vectors.mix32) {
    assert.equal(mix32(entry.x), entry.mix32, `mix32(${entry.x})`)
    assert.equal(unmix32(entry.x), entry.unmix32, `unmix32(${entry.x})`)
    assert.equal(unmix32(mix32(entry.x)), entry.x)
  }
  for (const entry of vectors.fnv1a32) assert.equal(fnv1a32(entry.text), entry.fnv1a32, JSON.stringify(entry.text))
})

test('drawU32 and pinSeed match every vector', () => {
  for (const entry of vectors.draws) assert.equal(drawU32(entry.seed, entry.key), entry.u, `${entry.seed} ${entry.key}`)
  for (const entry of vectors.pin) {
    assert.equal(pinSeed(entry.u), entry.seed, `pin ${entry.u}`)
    assert.equal(drawU32(entry.seed, 'pin'), entry.u)
  }
})

test('the mappings match every vector', () => {
  for (const entry of vectors.randInt) assert.equal(randIntFrom(entry.u, entry.min, entry.max), entry.value, JSON.stringify(entry))
  for (const entry of vectors.rand) assert.equal(randFrom(entry.u, entry.min, entry.max), entry.value, JSON.stringify(entry))
  for (const entry of vectors.pick) assert.equal(pickIndex(entry.u, entry.length), entry.index, JSON.stringify(entry))
  for (const entry of vectors.chance) assert.equal(chanceFrom(entry.u, entry.p), entry.value, JSON.stringify(entry))
  for (const entry of vectors.randColor) {
    for (const [name, u] of Object.entries(entry.components)) assert.equal(colorComponentDraw(entry.u, name), u, `${entry.u} ${name}`)
    assert.equal(randColorFrom(entry.u, entry.given), entry.value, JSON.stringify(entry))
  }
})

test('keys join their segments as the vectors do', () => {
  for (const entry of vectors.keys) assert.equal(joinKey(...entry.segments), entry.key, JSON.stringify(entry.segments))
})
