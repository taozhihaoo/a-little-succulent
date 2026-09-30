/** 物种注册表：引擎通过它找到物种定义（07 §3，SpeciesDef 由实现提取）。 */
import type { SpeciesId } from '../world'
import { ECHEVERIA } from './echeveria'
import type { SpeciesDef } from './index'

const REGISTRY: Record<SpeciesId, SpeciesDef> = {
  echeveria: ECHEVERIA,
}

export function getSpecies(id: string): SpeciesDef {
  const species = REGISTRY[id as SpeciesId]
  if (!species) throw new Error(`unknown species: ${id}`)
  return species
}
