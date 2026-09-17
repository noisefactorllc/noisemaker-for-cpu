import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { eligibleEffectIds, excludedEffects, sourceEffectIds } from '../src/effects/generated/upstream-snapshot.js'

// export-kit/compat-effects.json is the list the Noisedeck export dialog trusts. It is generated
// (export-kit/README-generation.md), so an upstream sync that forgets to regenerate it silently
// publishes a stale claim. It once listed 205 effects while the snapshot rendered 208.
test('export kit compat list names exactly the effects the snapshot renders', async () => {
  const excluded = new Set(Object.values(excludedEffects).flat())
  const derived = sourceEffectIds.filter((id) => !excluded.has(id)).sort()
  assert.deepEqual(derived, [...eligibleEffectIds].sort())
  const listed = JSON.parse(await readFile(new URL('../export-kit/compat-effects.json', import.meta.url), 'utf8'))
  assert.deepEqual(listed, derived)
})
