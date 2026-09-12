import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  artSlotMainKeys,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtifactCleanupConfig,
  CleanupBuildProfile,
  CleanupPattern,
  CleanupProfileState,
  ICachedArtifact,
} from '@genshin-optimizer/gi/db'
import { resolveCleanupProfile } from '@genshin-optimizer/gi/db'

export type TriageTier = 'prime' | 'solid' | 'filler'
export type TriageReason =
  | 'safety'
  | 'pattern'
  | 'prime'
  | 'solid'
  | 'filler'
  | 'floor'

export type TriageArtifact = {
  id: string
  reason: TriageReason
  tier?: TriageTier
  profileIds: string[]
}

export type ArtifactProfileTriageResult = {
  candidates: string[]
  safeIds: string[]
  protected: TriageArtifact[]
  coverageMissing: string[]
  demandTargets: number
  tierCounts: Record<TriageTier, number>
}

type Target = {
  id: string
  profile: CleanupBuildProfile
  setKey: ArtifactSetKey
  slotKey: ArtifactSlotKey
  mainStatKey: MainStatKey
  required: number
}
type Match = { target: Target; tier: TriageTier; score: number }

function substatKeys(artifact: ICachedArtifact) {
  return new Set(
    artifact.substats
      .map(({ key }) => key)
      .filter((key): key is SubstatKey => Boolean(key))
  )
}
function hasFourInitialSubstats(artifact: ICachedArtifact) {
  return (
    substatKeys(artifact).size === 4 &&
    (artifact.totalRolls === undefined || artifact.totalRolls >= 4)
  )
}
function rollValue(artifact: ICachedArtifact) {
  return artifact.substats.reduce(
    (total, substat) => total + (substat.efficiency || 0),
    0
  )
}
function profileSetKeys(profile: CleanupBuildProfile) {
  return new Set([
    ...profile.setTargets.fourPieceSets,
    ...profile.setTargets.halfSets,
  ])
}
function allowedMainStats(
  profile: CleanupBuildProfile,
  slotKey: ArtifactSlotKey
) {
  const fixed = artSlotMainKeys[slotKey]
  if (fixed.length === 1) return fixed as readonly MainStatKey[]
  return Object.entries(profile.mainStatWeights[slotKey] ?? {})
    .filter(([, weight]) => (weight ?? 0) > 0)
    .map(([key]) => key as MainStatKey)
}
function coreStats(profile: CleanupBuildProfile) {
  const entries = Object.entries(profile.substatWeights)
    .filter(([, weight]) => (weight ?? 0) >= profile.substatWeightThreshold)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0)) as [SubstatKey, number][]
  const must = new Set(
    entries
      .filter(([, weight]) => weight >= profile.mustPresentWeightThreshold)
      .map(([key]) => key)
  )
  const nonMust = entries.filter(([key]) => !must.has(key))
  const limited =
    profile.kOverride === undefined
      ? nonMust
      : nonMust.slice(0, profile.kOverride)
  return { core: new Set([...must, ...limited.map(([key]) => key)]), must }
}
function matchTarget(
  artifact: ICachedArtifact,
  target: Target
): Match | undefined {
  if (
    artifact.setKey !== target.setKey ||
    artifact.slotKey !== target.slotKey ||
    artifact.mainStatKey !== target.mainStatKey
  )
    return undefined
  const stats = substatKeys(artifact)
  const { core, must } = coreStats(target.profile)
  if ([...must].some((stat) => !stats.has(stat))) return undefined
  const matchedCore = [...core].filter((stat) => stats.has(stat)).length
  const minorMatches = Object.entries(target.profile.substatWeights).filter(
    ([stat, weight]) =>
      (weight ?? 0) > 0 &&
      (weight ?? 0) < target.profile.substatWeightThreshold &&
      stats.has(stat as SubstatKey)
  ).length
  if (!matchedCore && !minorMatches) return undefined
  const allCore = core.size > 0 && matchedCore === core.size
  const tier: TriageTier =
    allCore && hasFourInitialSubstats(artifact)
      ? 'prime'
      : allCore
        ? 'solid'
        : 'filler'
  return {
    target,
    tier,
    score:
      core.size * 10 + matchedCore * 3 + minorMatches + rollValue(artifact),
  }
}
function matchesPattern(artifact: ICachedArtifact, pattern: CleanupPattern) {
  if (!pattern.enabled) return false
  if (pattern.setKeys?.length && !pattern.setKeys.includes(artifact.setKey))
    return false
  if (pattern.slotKey && pattern.slotKey !== artifact.slotKey) return false
  if (
    pattern.mainStatKeys?.length &&
    !pattern.mainStatKeys.includes(artifact.mainStatKey)
  )
    return false
  if (pattern.requiresFourInitialSubstats && !hasFourInitialSubstats(artifact))
    return false
  const stats = substatKeys(artifact)
  return pattern.requiredSubstats.every((stat) => stats.has(stat))
}

function matchesBuiltInPattern(
  artifact: ICachedArtifact,
  config: ArtifactCleanupConfig,
  profiles: CleanupProfileState[]
) {
  if (!hasFourInitialSubstats(artifact)) return false
  const stats = substatKeys(artifact)
  if (
    config.builtInPatterns.doubleCritFourStart &&
    stats.has('critRate_') &&
    stats.has('critDMG_')
  )
    return true
  if (!stats.has('enerRech_')) return false
  if (config.builtInPatterns.erEverywhere) return true
  if (!config.builtInPatterns.erForSupportSustain) return false
  return profiles.some((state) => {
    if (state.stale) return false
    const profile = resolveCleanupProfile(state)
    return (
      profile.active &&
      profile.roles.some((role) => role === 'support' || role === 'sustain') &&
      profileSetKeys(profile).has(artifact.setKey)
    )
  })
}

function targetsForProfile(
  profile: CleanupBuildProfile,
  margin: number
): Target[] {
  const sets = profileSetKeys(profile)
  return [...sets].flatMap((setKey) =>
    allArtifactSlotKeys.flatMap((slotKey) =>
      allowedMainStats(profile, slotKey).map((mainStatKey) => ({
        id: `${profile.id}:${setKey}:${slotKey}:${mainStatKey}`,
        profile,
        setKey,
        slotKey,
        mainStatKey,
        required: 1 + margin,
      }))
    )
  )
}

/**
 * Deterministic profile-based reservation. It never marks equipped, saved,
 * level-20, non-5-star, or pattern-matching artifacts as safe to unlock.
 */
export function analyzeArtifactProfileTriage({
  artifacts,
  config,
  referencedArtifactIds = new Set<string>(),
  ownedCharacterKeys = [],
  teamTargetCharacterKeys = [],
}: {
  artifacts: readonly ICachedArtifact[]
  config: ArtifactCleanupConfig
  referencedArtifactIds?: Set<string>
  ownedCharacterKeys?: string[]
  teamTargetCharacterKeys?: string[]
}): ArtifactProfileTriageResult {
  const activeStates = config.profiles.filter((state) => {
    const profile = resolveCleanupProfile(state)
    return profile.active && !state.stale
  })
  const profiles = activeStates.map(resolveCleanupProfile)
  const coverageMissing = ownedCharacterKeys.filter((characterKey) => {
    const coveredByProfile = profiles.some(
      (profile) => profile.characterKey === characterKey
    )
    const coveredByTeam = teamTargetCharacterKeys.includes(characterKey)
    return (
      !coveredByProfile &&
      !coveredByTeam &&
      config.characterCoverage[characterKey as never] !== 'notRelevant'
    )
  })
  const targets = profiles.flatMap((profile) =>
    targetsForProfile(profile, Math.max(0, config.demandMargin))
  )
  const protectedById = new Map<string, TriageArtifact>()
  const candidates: ICachedArtifact[] = []
  const protect = (
    artifact: ICachedArtifact,
    reason: TriageReason,
    profileIds: string[] = [],
    tier?: TriageTier
  ) => {
    const old = protectedById.get(artifact.id)
    if (!old || (tier === 'prime' && old.tier !== 'prime'))
      protectedById.set(artifact.id, {
        id: artifact.id,
        reason,
        tier,
        profileIds,
      })
  }

  artifacts.forEach((artifact) => {
    if (
      artifact.rarity !== 5 ||
      artifact.level >= 20 ||
      Boolean(artifact.location) ||
      referencedArtifactIds.has(artifact.id)
    ) {
      protect(artifact, 'safety')
      return
    }
    if (
      matchesBuiltInPattern(artifact, config, activeStates) ||
      config.patterns.some((pattern) => matchesPattern(artifact, pattern))
    ) {
      protect(artifact, 'pattern')
      return
    }
    candidates.push(artifact)
  })

  const unmatched = new Set(candidates.map(({ id }) => id))
  const matches = new Map<string, Match[]>()
  candidates.forEach((artifact) => {
    matches.set(
      artifact.id,
      targets
        .map((target) => matchTarget(artifact, target))
        .filter((match): match is Match => Boolean(match))
        .sort(
          (a, b) => b.score - a.score || a.target.id.localeCompare(b.target.id)
        )
    )
  })
  const targetAssigned = new Map<string, number>()
  const targetFillerAssigned = new Map<string, number>()
  const byTier = (tier: TriageTier) =>
    candidates
      .filter((artifact) => unmatched.has(artifact.id))
      .flatMap((artifact) =>
        (matches.get(artifact.id) ?? [])
          .filter((match) => match.tier === tier)
          .map((match) => ({ artifact, match }))
      )
      .sort(
        (a, b) =>
          b.match.score - a.match.score ||
          rollValue(b.artifact) - rollValue(a.artifact) ||
          a.artifact.id.localeCompare(b.artifact.id)
      )

  // Prime pieces are always retained. Solid and filler pieces only reserve an
  // unfilled target, with the configured filler cap.
  byTier('prime').forEach(({ artifact, match }) => {
    if (!unmatched.delete(artifact.id)) return
    targetAssigned.set(
      match.target.id,
      (targetAssigned.get(match.target.id) ?? 0) + 1
    )
    protect(artifact, 'prime', [match.target.profile.id], 'prime')
  })
  ;(['solid', 'filler'] as const).forEach((tier) =>
    byTier(tier).forEach(({ artifact, match }) => {
      if (!unmatched.has(artifact.id)) return
      const assigned = targetAssigned.get(match.target.id) ?? 0
      if (assigned >= match.target.required) return
      if (
        tier === 'filler' &&
        (targetFillerAssigned.get(match.target.id) ?? 0) >= config.fillerCap
      )
        return
      unmatched.delete(artifact.id)
      targetAssigned.set(match.target.id, assigned + 1)
      if (tier === 'filler')
        targetFillerAssigned.set(
          match.target.id,
          (targetFillerAssigned.get(match.target.id) ?? 0) + 1
        )
      protect(artifact, tier, [match.target.profile.id], tier)
    })
  )

  const floors =
    config.keepRulePreset === 'extra' ? config.extraFloors : config.floors
  allArtifactSlotKeys.forEach((slotKey) => {
    const setKeys = new Set(artifacts.map(({ setKey }) => setKey))
    setKeys.forEach((setKey) => {
      const kept = artifacts.filter(
        (artifact) =>
          artifact.setKey === setKey &&
          artifact.slotKey === slotKey &&
          protectedById.has(artifact.id)
      ).length
      const needed = Math.max(0, floors[slotKey] - kept)
      candidates
        .filter(
          (artifact) =>
            unmatched.has(artifact.id) &&
            artifact.setKey === setKey &&
            artifact.slotKey === slotKey
        )
        .sort((a, b) => rollValue(b) - rollValue(a) || a.id.localeCompare(b.id))
        .slice(0, needed)
        .forEach((artifact) => {
          unmatched.delete(artifact.id)
          protect(artifact, 'floor')
        })
    })
  })

  const tierCounts: Record<TriageTier, number> = {
    prime: 0,
    solid: 0,
    filler: 0,
  }
  protectedById.forEach(({ tier }) => {
    if (tier) tierCounts[tier]++
  })
  return {
    candidates: candidates.map(({ id }) => id),
    safeIds: coverageMissing.length
      ? []
      : candidates
          .filter((artifact) => artifact.lock && unmatched.has(artifact.id))
          .map(({ id }) => id),
    protected: [...protectedById.values()],
    coverageMissing,
    demandTargets: targets.length,
    tierCounts,
  }
}
