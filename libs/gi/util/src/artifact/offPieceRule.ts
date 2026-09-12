import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import type { IArtifact } from '@genshin-optimizer/gi/good'

const scalingStats = ['atk_', 'hp_', 'def_'] as const
const usefulStats = [...scalingStats, 'eleMas', 'enerRech_'] as const

/**
 * A conservative, set-independent rule for unusually flexible 5-star pieces.
 * It intentionally requires four initial substats and favors combinations that
 * can serve as strong off-pieces across several characters.
 */
export function matchesStrongOffPieceRule(artifact: IArtifact) {
  if (artifact.rarity !== 5 || !hasFourInitialSubstats(artifact)) return false

  const substats = new Set(
    [...artifact.substats, ...(artifact.unactivatedSubstats ?? [])]
      .map(({ key }) => key)
      .filter((key): key is SubstatKey => key !== '')
  )
  const has = (...keys: readonly SubstatKey[]) =>
    keys.some((key) => substats.has(key))
  const doubleCrit = has('critRate_') && has('critDMG_')

  switch (artifact.slotKey) {
    case 'flower':
    case 'plume':
      return doubleCrit && has(...usefulStats)
    case 'sands':
    case 'goblet':
      return doubleCrit
    case 'circlet':
      if (artifact.mainStatKey === 'critRate_')
        return has('critDMG_') && has(...usefulStats)
      if (artifact.mainStatKey === 'critDMG_')
        return has('critRate_') && has(...usefulStats)
      if (artifact.mainStatKey === 'heal_')
        return has('enerRech_') && has(...scalingStats)
      return doubleCrit
  }
}

function hasFourInitialSubstats(artifact: IArtifact) {
  if (artifact.totalRolls !== undefined)
    return artifact.totalRolls - Math.floor(artifact.level / 4) >= 4

  // Legacy/manual entries may not track totalRolls. Treat four visible lines
  // as four initial lines so the protection rule errs on the side of keeping.
  return artifact.substats.filter(({ key }) => key !== '').length >= 4
}
