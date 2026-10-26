import {
  allSubstatKeys,
  artSlotMainKeys,
  type CharacterKey,
  type SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  type ArtifactCleanupConfig,
  type CleanupBuildProfile,
  type CleanupCharacterKey,
  type CleanupPattern,
  type ICachedArtifact,
  resolveCleanupProfile,
} from '@genshin-optimizer/gi/db'
import { levelUpArtifact } from '@genshin-optimizer/gi/upopt'
import { getSubstatValue } from '@genshin-optimizer/gi/util'
import type {
  CleanupIncompleteEquipment,
  CleanupProfileMatch,
  CleanupReason,
} from './ArtifactCleanup.types'
import {
  allocateCleanupEquipment,
  type CleanupEquipmentEdge,
} from './ArtifactCleanupEquipment'
import { cleanupProfileGroups } from './ArtifactCleanupGroups'

const emptyBuild = {
  flower: undefined,
  plume: undefined,
  sands: undefined,
  goblet: undefined,
  circlet: undefined,
}

export function cleanupRelevantCharacters(
  owned: CharacterKey[],
  config: ArtifactCleanupConfig,
  teamCharacters: CharacterKey[] = []
) {
  return [
    ...new Set([
      ...(config.characterScope === 'owned' ? owned : teamCharacters),
      ...config.wishlist,
      ...(config.characterScope === 'allProfiles'
        ? config.profiles
            .filter(
              (state) => !state.stale && resolveCleanupProfile(state).active
            )
            .map(({ base }) => base.characterKey)
        : []),
    ]),
  ]
    .filter((key) => config.characterCoverage[key] !== 'notRelevant')
    .sort()
}
function fourInitial(artifact: ICachedArtifact) {
  return artifact.totalRolls !== undefined
    ? artifact.totalRolls - Math.floor(artifact.level / 4) >= 4
    : artifact.level < 4 &&
        artifact.substats.filter(({ key }) => key).length === 4
}
export function matchesCleanupPattern(
  artifact: ICachedArtifact,
  pattern: CleanupPattern
) {
  return (
    pattern.enabled &&
    (!pattern.setKeys?.length || pattern.setKeys.includes(artifact.setKey)) &&
    (!pattern.slotKey || pattern.slotKey === artifact.slotKey) &&
    (!pattern.mainStatKeys?.length ||
      pattern.mainStatKeys.includes(artifact.mainStatKey)) &&
    (!pattern.requiresFourInitialSubstats || fourInitial(artifact)) &&
    pattern.requiredSubstats.every((key) =>
      artifact.substats.some((stat) => stat.key === key)
    )
  )
}

/** Expected max-level substats from GO's future-roll model. Main stats are excluded. */
export function expectedCleanupSubstats(
  artifact: ICachedArtifact
): Partial<Record<SubstatKey, number>> {
  const expected: Partial<Record<SubstatKey, number>> = {}
  for (const {
    p,
    n: { subDistr },
  } of levelUpArtifact(artifact, emptyBuild)) {
    for (const key of allSubstatKeys) {
      if (key === artifact.mainStatKey) continue
      const ix = subDistr.subs.indexOf(key)
      const value = (subDistr.base[key] ?? 0) + (ix < 0 ? 0 : subDistr.mu[ix])
      expected[key] = (expected[key] ?? 0) + p * value
    }
  }
  if (!Object.values(expected).every(Number.isFinite))
    throw new Error('Invalid substats')
  return expected
}
function profileIsUsable(profile: CleanupBuildProfile) {
  return (
    (profile.kOverride === undefined ||
      (Number.isInteger(profile.kOverride) &&
        profile.kOverride >= 0 &&
        profile.kOverride <= 4)) &&
    Number.isFinite(profile.substatWeightThreshold) &&
    profile.substatWeightThreshold >= 0 &&
    profile.substatWeightThreshold <= 100 &&
    Number.isFinite(profile.mustPresentWeightThreshold) &&
    profile.mustPresentWeightThreshold >= 0 &&
    profile.mustPresentWeightThreshold <= 100 &&
    (profile.setTargets.fourPieceSets.length > 0 ||
      (profile.setTargets.halfSets.length >= 2 &&
        (!profile.setTargets.halfSetOptions ||
          (profile.setTargets.halfSetOptions.length === 2 &&
            profile.setTargets.halfSetOptions[0].some((a) =>
              profile.setTargets.halfSetOptions![1].some((b) => a !== b)
            ))))) &&
    [...profile.setTargets.fourPieceSets, ...profile.setTargets.halfSets]
      .length > 0 &&
    Object.values(profile.substatWeights).some(
      (weight) => Number.isFinite(weight) && weight > 0
    ) &&
    Object.entries(profile.substatWeights).every(
      ([key, weight]) =>
        allSubstatKeys.some((stat) => stat === key) &&
        Number.isFinite(weight) &&
        (weight ?? 0) >= 0 &&
        (weight ?? 0) <= 100
    ) &&
    (['sands', 'goblet', 'circlet'] as const).every(
      (slot) =>
        Object.entries(profile.mainStatWeights[slot] ?? {}).some(
          ([, weight]) => (weight ?? 0) > 0
        ) &&
        Object.entries(profile.mainStatWeights[slot] ?? {}).every(
          ([key, weight]) =>
            artSlotMainKeys[slot].some((stat) => stat === key) &&
            Number.isFinite(weight) &&
            (weight ?? 0) >= 0 &&
            (weight ?? 0) <= 100
        )
    )
  )
}
export function cleanupProfileScore(
  artifact: ICachedArtifact,
  profile: CleanupBuildProfile,
  expected: Partial<Record<SubstatKey, number>>,
  allowOffPiece = false
) {
  if (
    !allowOffPiece &&
    ![
      ...profile.setTargets.fourPieceSets,
      ...profile.setTargets.halfSets,
    ].includes(artifact.setKey)
  )
    return undefined
  const fixed = artSlotMainKeys[artifact.slotKey].length === 1
  const mainWeight = fixed
    ? 100
    : profile.mainStatWeights[artifact.slotKey]?.[artifact.mainStatKey]
  if (!mainWeight || !Number.isFinite(mainWeight)) return undefined
  const known = [
    ...artifact.substats,
    ...(artifact.unactivatedSubstats ?? []),
  ].filter(({ key }) => key)
  const canReveal = known.length < 4 && artifact.level < 20
  const missingRequired = Object.entries(profile.substatWeights).filter(
    ([key, weight]) =>
      key !== artifact.mainStatKey &&
      (weight ?? 0) > 0 &&
      (weight ?? 0) >= profile.mustPresentWeightThreshold &&
      !known.some((stat) => stat.key === key)
  )
  if (missingRequired.length > (canReveal ? 4 - known.length : 0))
    return undefined
  const useful = Object.entries(profile.substatWeights)
    .filter(
      ([, weight]) =>
        (weight ?? 0) > 0 && (weight ?? 0) >= profile.substatWeightThreshold
    )
    .map(([key]) => key)
  const count = useful.filter(
    (key) =>
      key === artifact.mainStatKey || known.some((stat) => stat.key === key)
  ).length
  const requiredCount = profile.kOverride ?? Math.min(useful.length, 3)
  if (count + (canReveal ? 4 - known.length : 0) < requiredCount)
    return undefined
  const score =
    (allSubstatKeys.reduce((sum, key) => {
      if (key === artifact.mainStatKey) return sum
      return (
        sum +
        (((expected[key] ?? 0) / getSubstatValue(key, 5, 'max', false)) *
          (profile.substatWeights[key] ?? 0)) /
          100
      )
    }, 0) *
      mainWeight) /
    100
  return Number.isFinite(score) && score > 0 ? score : undefined
}
function preference(
  artifact: ICachedArtifact,
  profile: CleanupBuildProfile,
  config: ArtifactCleanupConfig
) {
  if (!fourInitial(artifact)) return 0
  const keys = new Set(artifact.substats.map(({ key }) => key))
  if (
    config.builtInPatterns.doubleCritFourStart &&
    keys.has('critRate_') &&
    keys.has('critDMG_')
  )
    return 1
  return keys.has('enerRech_') &&
    (config.builtInPatterns.erEverywhere ||
      (config.builtInPatterns.erForSupportSustain &&
        profile.roles.some((role) => role === 'support' || role === 'sustain')))
    ? 1
    : 0
}
export type CleanupReservations = {
  matches: Map<string, CleanupProfileMatch[]>
  reservations: Map<string, CleanupReason[]>
  assignedMatches: Map<
    string,
    { match: CleanupProfileMatch; reason: 'equipment' | 'reserve' }
  >
  coveredCharacters: Set<CleanupCharacterKey>
  invalidArtifactIds: Set<string>
  invalidProfileCharacters: Set<CleanupCharacterKey>
  warnings: string[]
  incompleteGroups: CleanupIncompleteEquipment[]
}

/** Alternative profiles share character/slot demand; expanded set families
 * share a reserve group rather than reserving a copy for every concrete set. */
export async function analyzeCleanupProfiles({
  artifacts,
  config,
  relevantCharacters,
  referencedArtifactIds = new Set<string>(),
  coveredProfileIds = new Set<string>(),
  shouldCancel = () => false,
  onProgress,
}: {
  artifacts: readonly ICachedArtifact[]
  config: ArtifactCleanupConfig
  relevantCharacters: CleanupCharacterKey[]
  referencedArtifactIds?: Set<string>
  coveredProfileIds?: Set<string>
  shouldCancel?: () => boolean
  onProgress?: (current: number, total: number) => void
}): Promise<CleanupReservations> {
  const relevant = new Set(relevantCharacters)
  const profiles: CleanupBuildProfile[] = []
  const warnings: string[] = []
  const invalidProfileCharacters = new Set<CleanupCharacterKey>()
  for (const state of config.profiles) {
    const profile = resolveCleanupProfile(state)
    if (
      !profile.active ||
      state.stale ||
      !relevant.has(profile.characterKey) ||
      coveredProfileIds.has(profile.id)
    )
      continue
    try {
      if (!profileIsUsable(profile)) throw new Error('Incomplete profile')
      profiles.push(profile)
    } catch {
      warnings.push(`${profile.characterKey}: ${profile.name || profile.id}`)
      invalidProfileCharacters.add(profile.characterKey)
    }
  }
  const matches = new Map<string, CleanupProfileMatch[]>()
  const reservations = new Map<string, CleanupReason[]>()
  const assignedMatches: CleanupReservations['assignedMatches'] = new Map()
  const invalidArtifactIds = new Set<string>()
  const equipmentEdges: CleanupEquipmentEdge[] = []
  const protect = (id: string, reason: CleanupReason) => {
    const reasons = reservations.get(id) ?? []
    if (!reasons.includes(reason)) reasons.push(reason)
    reservations.set(id, reasons)
  }
  const eligible = artifacts.filter((artifact) => artifact.rarity === 5)
  onProgress?.(0, eligible.length)
  let lastYield = Date.now()
  for (let index = 0; index < eligible.length; index++) {
    if (shouldCancel()) throw new Error('Cleanup cancelled')
    const artifact = eligible[index]
    try {
      const expected = expectedCleanupSubstats(artifact)
      for (const profile of profiles) {
        const score = cleanupProfileScore(artifact, profile, expected, true)
        if (score !== undefined)
          equipmentEdges.push({
            artifact,
            match: {
              profileId: profile.id,
              characterKey: profile.characterKey,
              name: profile.name,
              score,
              basis: 'profileEstimate',
            },
            preferred: preference(artifact, profile, config),
            protected:
              Boolean(artifact.location) ||
              referencedArtifactIds.has(artifact.id),
          })
      }
      const found = profiles
        .flatMap((profile) => {
          const score = cleanupProfileScore(artifact, profile, expected)
          return score === undefined
            ? []
            : [
                {
                  profileId: profile.id,
                  characterKey: profile.characterKey,
                  name: profile.name,
                  score,
                  basis: 'profileEstimate' as const,
                },
              ]
        })
        .sort(
          (a, b) => b.score - a.score || a.profileId.localeCompare(b.profileId)
        )
      matches.set(artifact.id, found)
      if (
        config.patterns.some((pattern) =>
          matchesCleanupPattern(artifact, pattern)
        )
      )
        protect(artifact.id, 'pattern')
    } catch {
      invalidArtifactIds.add(artifact.id)
    }
    if (Date.now() - lastYield >= 12) {
      onProgress?.(index + 1, eligible.length)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      lastYield = Date.now()
    }
  }
  onProgress?.(eligible.length, eligible.length)
  equipmentEdges.sort(
    (a, b) =>
      Number(b.protected) - Number(a.protected) ||
      b.match.score - a.match.score ||
      b.preferred - a.preferred ||
      a.artifact.id.localeCompare(b.artifact.id)
  )
  const validIds = new Set(profiles.map(({ id }) => id))
  const groups = cleanupProfileGroups(config, coveredProfileIds)
    .map((group) => ({
      ...group,
      profiles: group.profiles.filter(({ id }) => validIds.has(id)),
    }))
    .filter(({ profiles }) => profiles.length)
  const { assigned, incompleteGroups } = await allocateCleanupEquipment({
    groups,
    edges: equipmentEdges,
    config,
    referenced: referencedArtifactIds,
    shouldCancel,
  })
  for (const [id, assignment] of assigned) {
    assignedMatches.set(id, assignment)
    protect(id, assignment.reason)
  }
  const floors =
    config.keepRulePreset === 'extra' ? config.extraFloors : config.floors
  const buckets = new Map<string, ICachedArtifact[]>()
  for (const art of eligible) {
    const key = `${art.setKey}:${art.slotKey}`
    buckets.set(key, [...(buckets.get(key) ?? []), art])
  }
  for (const bucket of buckets.values()) {
    const kept = bucket.filter(
      (art) => artifactProtected(art) || reservations.has(art.id)
    ).length
    const score = (art: ICachedArtifact) =>
      Math.max(0, ...(matches.get(art.id) ?? []).map(({ score }) => score))
    bucket
      .filter(
        (art) =>
          !artifactProtected(art) &&
          !reservations.has(art.id) &&
          !invalidArtifactIds.has(art.id)
      )
      .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))
      .slice(0, Math.max(0, floors[bucket[0].slotKey] - kept))
      .forEach(({ id }) => protect(id, 'floor'))
  }
  function artifactProtected(art: ICachedArtifact) {
    return Boolean(art.location) || referencedArtifactIds.has(art.id)
  }
  return {
    matches,
    reservations,
    assignedMatches,
    coveredCharacters: new Set(
      profiles.map(({ characterKey }) => characterKey)
    ),
    invalidArtifactIds,
    invalidProfileCharacters,
    warnings,
    incompleteGroups,
  }
}
