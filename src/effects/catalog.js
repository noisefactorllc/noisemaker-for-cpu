import { EffectDefinition } from './definition.js'
import { EffectRegistry } from './registry.js'
import { effectRecords } from './generated/upstream-snapshot.js'
import { kernels } from './generated/kernels.js'
import { canonicalKernelFactories } from './generated/canonical-kernels.js'
import { canonicalAdapterFactories } from './adapters/index.js'

export const effectCatalog = Object.freeze(effectRecords.map((spec) => new EffectDefinition(spec)))

export function createDefaultRegistry() {
  return new EffectRegistry(effectCatalog)
}

export const kernelFactories = new Map(Object.entries({ ...canonicalKernelFactories, ...canonicalAdapterFactories }))

export { canonicalAdapterFactories, canonicalKernelFactories, kernels }
