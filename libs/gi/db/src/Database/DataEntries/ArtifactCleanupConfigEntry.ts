import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allArtifactSlotKeys,
  allCharacterKeys,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '../ArtCharDatabase'
import { DataEntry } from '../DataEntry'

export type CleanupRole = 'dps' | 'support' | 'sustain'
export type CleanupStyle = 'on-field' | 'off-field'

/** GGArtifact profiles can support characters before GO has their combat data. */
export const allCleanupCharacterKeys = [
  ...allCharacterKeys,
  'Vodyanitsa',
  'Vesna',
] as const
export type CleanupCharacterKey = (typeof allCleanupCharacterKeys)[number]

export type CleanupSetTargets = {
  fourPieceSets: ArtifactSetKey[]
  /** GGArtifact's named 2-piece categories. They intentionally stay explicit
   * in storage so a later set table can be expanded without losing the import. */
  halfSetFamilies: string[]
  halfSets: ArtifactSetKey[]
  /** The two independent choices in a 2+2 build, before taking their union. */
  halfSetOptions?: ArtifactSetKey[][]
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
  characterKey: CleanupCharacterKey
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
  normalizer?: number
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
  version: 3
  selectedSetKeys: ArtifactSetKey[]
  characterScope: 'allProfiles' | 'owned'
  /** Explicit grouping overrides, indexed by profile id. */
  profileGroups: Record<string, string>
  /** Confirmed coverage only; suggestions never enter this map automatically. */
  goProfileCoverage: Record<string, string[]>
  importWarnings: string[]
  wishlist: CleanupCharacterKey[]
  upgradeThresholds: { minProbability: number; minAverageIncrease: number }
  /** Explicit build selection; undefined uses the suggestion for the chosen sets. */
  selectedLoadoutIds?: string[]
  /** A piece is in demand when it appears in one of the best N optimizer builds. */
  topN: number
  /** Time limit for one optimizer run, in seconds. */
  maxLoadoutSeconds: number
  demandMargin: number
  fillerCap: number
  keepRulePreset: CleanupKeepRulePreset
  floors: Record<ArtifactSlotKey, number>
  extraFloors: Record<ArtifactSlotKey, number>
  profiles: CleanupProfileState[]
  patterns: CleanupPattern[]
  builtInPatterns: CleanupBuiltInPatterns
  characterCoverage: Partial<Record<CleanupCharacterKey, 'notRelevant'>>
}

export function initialArtifactCleanupConfig(): ArtifactCleanupConfig {
  return {
    version: 3,
    selectedSetKeys: [],
    characterScope: 'allProfiles',
    profileGroups: {},
    goProfileCoverage: {},
    importWarnings: [],
    wishlist: [],
    upgradeThresholds: { minProbability: 5, minAverageIncrease: 0 },
    topN: 20,
    maxLoadoutSeconds: 30,
    demandMargin: 1,
    fillerCap: 1,
    keepRulePreset: 'normal',
    floors: { flower: 0, plume: 0, sands: 0, goblet: 0, circlet: 0 },
    extraFloors: { flower: 0, plume: 0, sands: 0, goblet: 0, circlet: 0 },
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
  const nonnegative = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, value)
      : fallback
  const floors = (
    value: Partial<Record<ArtifactSlotKey, number>> | undefined
  ) =>
    Object.fromEntries(
      allArtifactSlotKeys.map((slot) => [
        slot,
        Math.floor(nonnegative(value?.[slot], 0)),
      ])
    ) as Record<ArtifactSlotKey, number>
  return {
    ...defaults,
    ...config,
    version: 3,
    selectedSetKeys: Array.isArray(config.selectedSetKeys)
      ? [
          ...new Set(
            config.selectedSetKeys.filter((key) =>
              allArtifactSetKeys.includes(key)
            )
          ),
        ]
      : [],
    characterScope: config.characterScope === 'owned' ? 'owned' : 'allProfiles',
    profileGroups: Object.fromEntries(
      Object.entries(config.profileGroups ?? {}).filter(
        ([, group]) => typeof group === 'string' && group.length > 0
      )
    ),
    goProfileCoverage: Object.fromEntries(
      Object.entries(config.goProfileCoverage ?? {})
        .filter(([, ids]) => Array.isArray(ids))
        .map(([id, ids]) => [
          id,
          [...new Set(ids.filter((value) => typeof value === 'string'))],
        ])
    ),
    importWarnings: Array.isArray(config.importWarnings)
      ? config.importWarnings.filter((value) => typeof value === 'string')
      : [],
    wishlist: Array.isArray(config.wishlist)
      ? [
          ...new Set(
            config.wishlist.filter((key) =>
              allCleanupCharacterKeys.includes(key)
            )
          ),
        ]
      : [],
    selectedLoadoutIds: Array.isArray(config.selectedLoadoutIds)
      ? [
          ...new Set(
            config.selectedLoadoutIds.filter(
              (value) => typeof value === 'string'
            )
          ),
        ]
      : undefined,
    topN: Math.min(
      200,
      Math.max(1, Math.floor(nonnegative(config.topN, defaults.topN)))
    ),
    maxLoadoutSeconds: Math.min(
      600,
      Math.max(
        1,
        nonnegative(config.maxLoadoutSeconds, defaults.maxLoadoutSeconds)
      )
    ),
    demandMargin: Math.floor(
      nonnegative(config.demandMargin, defaults.demandMargin)
    ),
    fillerCap: Math.floor(nonnegative(config.fillerCap, defaults.fillerCap)),
    upgradeThresholds: {
      minProbability: Math.min(
        100,
        nonnegative(
          config.upgradeThresholds?.minProbability,
          defaults.upgradeThresholds.minProbability
        )
      ),
      minAverageIncrease: nonnegative(
        config.upgradeThresholds?.minAverageIncrease,
        0
      ),
    },
    floors: floors(config.floors),
    extraFloors: floors(config.extraFloors),
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
