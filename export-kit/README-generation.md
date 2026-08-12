# export-kit/ — how `compat-effects.json` is made

`kit.config.json` builds this repo's Noisedeck export kit (kit id `cpu`). It
declares `compat: {"mode": "list", "fromJsonList": "export-kit/compat-effects.json"}`,
so the shipped `compat.json` — the list the export dialog reads to decide which
effects this kit can render — is exactly the array in `compat-effects.json`.

JSON carries no comments, so the header comment that file would otherwise hold
lives here.

## What `compat-effects.json` is

A sorted JSON array of the catalog ids this port renders: the 210
`sourceEffectIds` of `src/effects/generated/upstream-snapshot.js`, minus that
same snapshot's five `excludedEffects` (reactive `synth/roll`, `synth/scope`,
`synth/spectrum`; mesh `render/meshLoader`, `render/meshRender`), which is 205
today. The exclusions are documented in `docs/EFFECTS.md`; listing them here
would tell a user the kit renders effects it refuses.

The other three CPU ports derive the same claim with `fromBundleMetadata` over
their generated `bundle/metadata.json`. This port ships no such file, so the
list is generated and committed instead — which means it is a checked-in
derivative and can go stale. Regenerate it whenever
`src/effects/generated/upstream-snapshot.js` changes, in the same commit as the
upstream sync.

## Regenerating it

From the repo root:

```sh
node -e '
import("./src/effects/generated/upstream-snapshot.js").then(async ({ sourceEffectIds, excludedEffects, eligibleEffectIds }) => {
  const excluded = new Set(Object.values(excludedEffects).flat())
  const ids = sourceEffectIds.filter((id) => !excluded.has(id)).sort()
  if (JSON.stringify(ids) !== JSON.stringify([...eligibleEffectIds].sort())) {
    throw new Error("derived list disagrees with the snapshot eligibleEffectIds")
  }
  const fs = await import("node:fs/promises")
  await fs.writeFile("export-kit/compat-effects.json", JSON.stringify(ids, null, 2) + "\n")
  console.log(`wrote ${ids.length} ids`)
})
'
```

The equality check is the point of running it this way rather than dumping
`eligibleEffectIds` straight out: the snapshot states the exclusions twice, once
as a rule and once as a result, and a sync that moved one without the other
would otherwise be published as a silently different compat claim.

The builder sorts what it derives before writing `compat.json`, and reads this
file through the git index, so an unstaged regeneration fails the build rather
than shipping a list CI could not reproduce.
