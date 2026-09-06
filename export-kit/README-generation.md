# export-kit/ — how `compat-effects.json` is made

`kit.config.json` builds this repo's Noisedeck export kit (kit id `cpu`). It declares `compat: {"mode": "list", "fromJsonList": "export-kit/compat-effects.json"}`. The shipped `compat.json` is therefore exactly the array in `compat-effects.json`. The export dialog reads this list to determine which effects the kit can render.

JSON carries no comments, so the header comment that file would otherwise hold
lives here.

## What `compat-effects.json` is

This is a sorted JSON array of the catalog ids this port renders. Start with the 210 `sourceEffectIds` in `src/effects/generated/upstream-snapshot.js`. Subtract the same snapshot's five `excludedEffects`:

- Reactive effects: `synth/roll`, `synth/scope`, `synth/spectrum`.
- Mesh effects: `render/meshLoader`, `render/meshRender`.

The result is 205 today. `docs/EFFECTS.md` documents the exclusions. Including these effects in the compatibility list would tell users that the kit renders effects it refuses.

The other three CPU ports derive the same claim with `fromBundleMetadata` over
their generated `bundle/metadata.json`. This port ships no such file. The repository instead contains a generated, committed list, which can become outdated. Regenerate it whenever
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

The equality check compares the snapshot's exclusions as a rule against its exclusions as a result. This is why the command does not simply copy `eligibleEffectIds`. Without this check, an upstream sync could change only one representation and silently publish a different compatibility claim.

The builder sorts its result before writing `compat.json`. It reads the source list through the git index. An unstaged regeneration therefore fails the build instead of publishing a list that CI could not reproduce.
