import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '../ArtCharDatabase'
import { DataEntry } from '../DataEntry'

export type CleanupRole = 'dps' | 'support' | 'sustain'
export type CleanupStyle = 'on-field' | 'off-field'

export type CleanupSetTargets = {
  fourPieceSets: ArtifactSetKey[]
  /** GGArtifact's named 2-piece categories. They intentionally stay explicit
   * in storage so a later set table can be expanded without losing the import. */
  halfSetFamilies: string[]
  halfSets: ArtifactSetKey[]
}

export type CleanupPattern = {
  id: string
  name: string
  enabled: boolean
  setKeys?: ArtifactSetKey[]
  slotKey?: ArtifactSlotKey
  mainStatKeys?: MainStatKey[]
  requiredSubstats: SubstatKey[]
  requiresFourInitialSubstats?: boolean
}

export type CleanupBuiltInPatterns = {
  doubleCritFourStart: boolean
  erForSupportSustain: boolean
  erEverywhere: boolean
}

export type CleanupKeepRulePreset = 'normal' | 'extra'

export type CleanupBuildProfile = {
  id: string
  characterKey: CharacterKey
  name: string
  active: boolean
  roles: CleanupRole[]
  styles: CleanupStyle[]
  setTargets: CleanupSetTargets
  mainStatWeights: Partial<
    Record<ArtifactSlotKey, Partial<Record<MainStatKey, number>>>
  >
  substatWeights: Partial<Record<SubstatKey, number>>
  kOverride?: number
  substatWeightThreshold: number
  mustPresentWeightThreshold: number
  source?: string
  normalizer?: string
}

export type CleanupProfileState = {
  /** Undefined for a profile created in GO. */
  ggBuildId?: string
  base: CleanupBuildProfile
  /** Kept separately so re-importing never discards local edits. */
  overrides?: Partial<CleanupBuildProfile>
  stale?: boolean
}

export type ArtifactCleanupConfig = {
  version: 1
  upgradeThresholds: { minProbability: number; minAverageIncrease: number }
  demandMargin: number
  fillerCap: number
  keepRulePreset: CleanupKeepRulePreset
  floors: Record<ArtifactSlotKey, number>
  extraFloors: Record<ArtifactSlotKey, number>
  profiles: CleanupProfileState[]
  patterns: CleanupPattern[]
  builtInPatterns: CleanupBuiltInPatterns
  characterCoverage: Partial<Record<CharacterKey, 'notRelevant'>>
}

export function initialArtifactCleanupConfig(): ArtifactCleanupConfig {
  return {
    version: 1,
    upgradeThresholds: { minProbability: 0, minAverageIncrease: 0 },
    demandMargin: 1,
    fillerCap: 1,
    keepRulePreset: 'normal',
    floors: { flower: 5, plume: 5, sands: 3, goblet: 3, circlet: 3 },
    extraFloors: { flower: 10, plume: 10, sands: 5, goblet: 3, circlet: 3 },
    profiles: [],
    patterns: [],
    builtInPatterns: {
      doubleCritFourStart: true,
      erForSupportSustain: true,
      erEverywhere: false,
    },
    characterCoverage: {},
  }
}

/** A deliberately permissive, forward-compatible entry. Imported profile data
 * is validated by the GGArtifact parser; this guard only prevents a damaged
 * saved value from making the artifact page unusable. */
function sanitizeConfig(value: unknown): ArtifactCleanupConfig {
  const defaults = initialArtifactCleanupConfig()
  if (!value || typeof value !== 'object') return defaults
  const config = value as Partial<ArtifactCleanupConfig>
  return {
    ...defaults,
    ...config,
    version: 1,
    upgradeThresholds: {
      ...defaults.upgradeThresholds,
      ...(config.upgradeThresholds ?? {}),
    },
    floors: { ...defaults.floors, ...(config.floors ?? {}) },
    extraFloors: { ...defaults.extraFloors, ...(config.extraFloors ?? {}) },
    keepRulePreset:
      config.keepRulePreset === 'extra' ? 'extra' : defaults.keepRulePreset,
    profiles: Array.isArray(config.profiles) ? config.profiles : [],
    patterns: Array.isArray(config.patterns) ? config.patterns : [],
    builtInPatterns: {
      ...defaults.builtInPatterns,
      ...(config.builtInPatterns ?? {}),
    },
    characterCoverage:
      config.characterCoverage && typeof config.characterCoverage === 'object'
        ? config.characterCoverage
        : {},
  }
}

export class ArtifactCleanupConfigEntry extends DataEntry<
  'artifact_cleanup_config',
  'artifact_cleanup_config',
  ArtifactCleanupConfig,
  ArtifactCleanupConfig
> {
  constructor(database: ArtCharDatabase) {
    super(
      database,
      'artifact_cleanup_config',
      initialArtifactCleanupConfig,
      'artifact_cleanup_config'
    )
  }

  override validate(obj: unknown): ArtifactCleanupConfig | undefined {
    return sanitizeConfig(obj)
  }
}

export function resolveCleanupProfile({
  base,
  overrides,
}: CleanupProfileState) {
  return { ...base, ...overrides } as CleanupBuildProfile
}
