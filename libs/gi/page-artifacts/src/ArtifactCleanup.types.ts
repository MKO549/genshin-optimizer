import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
} from '@genshin-optimizer/gi/consts'
import type { CleanupCharacterKey } from '@genshin-optimizer/gi/db'

export const cleanupRecommendations = [
  'protected',
  'keep',
  'level',
  'review',
  'discard',
] as const
export type CleanupRecommendation = (typeof cleanupRecommendations)[number]
export type CleanupReason =
  | 'equipped'
  | 'savedBuild'
  | 'rarity'
  | 'upgrade'
  | 'equipment'
  | 'reserve'
  | 'pattern'
  | 'floor'
  | 'coverage'
  | 'invalidData'
  | 'noDemand'
  | 'upgradeChance'
export type CleanupSkipReason =
  | 'missingTarget'
  | 'incompleteBuild'
  | 'theorycraftBuild'
  | 'invalidData'
  | 'searchLimit'
  | 'noWeapon'
  | 'noTeamData'
  | 'invalidTarget'
  | 'invalidConstraint'
  | 'nonFiniteValue'
  | 'noFeasibleBuild'
export type CleanupLoadout = {
  id: string
  characterKey: CharacterKey
  teamName: string
  characterName: string
  buildName: string
  reason?: CleanupSkipReason
  /** Identical builds in identical team contexts, analyzed only once. */
  duplicates?: { id: string; teamName: string; buildName: string }[]
}
export type CleanupGOEvidence = {
  loadout: CleanupLoadout
  status:
    | 'topBuild'
    | 'notInTop'
    | 'belowCurrent'
    | 'upgradeChance'
    | 'mainStatExcluded'
    | 'setExcluded'
    | 'artifactExcluded'
    | 'locationExcluded'
    | CleanupSkipReason
  /** Relative change against the current build, in percent. */
  averageIncrease?: number
  absoluteIncrease?: number
  priority?: number
  accuracy?: 'exact' | 'estimated'
  /** In one of the best optimizer builds. */
  upgrade?: boolean
  /** 1-based rank of the best optimizer build containing this piece. */
  rank?: number
  /** Value of the current build. */
  baseline?: number
  /** Value of the best optimizer build containing this piece. */
  bestValue?: number
  /** Value of the best optimizer build overall. */
  topValue?: number
  artifactIds?: string[]
  /** Upgrade Optimizer chance to beat the best build when leveled, 0–1. */
  probability?: number
}
export type CleanupProfileMatch = {
  profileId: string
  characterKey: CleanupCharacterKey
  name: string
  score: number
  basis: 'profileEstimate'
}
export type CleanupArtifactResult = {
  id: string
  setKey: ArtifactSetKey
  slotKey: ArtifactSlotKey
  level: number
  recommendation: CleanupRecommendation
  reasons: CleanupReason[]
  characterKeys: CleanupCharacterKey[]
  profileMatches: CleanupProfileMatch[]
  reservedFor: {
    characterKey: CleanupCharacterKey
    profileId: string
    reason: 'equipment' | 'reserve'
  }[]
  goEvidence: CleanupGOEvidence[]
  issues: string[]
  priority: number
}
export type ArtifactCleanupResult = {
  snapshot: string
  artifacts: CleanupArtifactResult[]
  analyzedLoadouts: CleanupLoadout[]
  skippedLoadouts: CleanupLoadout[]
  coverageMissing: CleanupCharacterKey[]
  profileWarnings: string[]
  profileCoverage: {
    profileId: string
    loadoutIds: string[]
    covered: boolean
  }[]
  incompleteGroups: CleanupIncompleteEquipment[]
  selectedSetKeys: ArtifactSetKey[]
  counts: Record<CleanupRecommendation, number>
}
export type CleanupIncompleteEquipment = {
  id: string
  characterKey: CleanupCharacterKey
  profileName: string
  missingSlots: ArtifactSlotKey[]
}
export type CleanupProgress = {
  current: number
  total: number
  phase: 'profiles' | 'builds'
  loadout?: CleanupLoadout
  candidateCurrent?: number
  candidateTotal?: number
  searchTested?: number
  searchElapsedMs?: number
  searchStage?: 'optimizing' | 'upgrading'
}
