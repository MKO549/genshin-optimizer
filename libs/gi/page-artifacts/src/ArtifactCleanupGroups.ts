import {
  type ArtifactCleanupConfig,
  type CleanupBuildProfile,
  type CleanupCharacterKey,
  resolveCleanupProfile,
} from '@genshin-optimizer/gi/db'

/** Stable suggestions ignore set alternatives, names, import order and build ids. */
export function suggestedCleanupGroup(profile: CleanupBuildProfile) {
  const sorted = (weights: Record<string, number | undefined>) =>
    Object.entries(weights)
      .filter(([, weight]) => (weight ?? 0) > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([
    profile.characterKey,
    [...profile.roles].sort(),
    [...profile.styles].sort(),
    sorted(profile.substatWeights),
    ...(['sands', 'goblet', 'circlet'] as const).map((slot) =>
      sorted(profile.mainStatWeights[slot] ?? {})
    ),
    profile.substatWeightThreshold,
    profile.mustPresentWeightThreshold,
  ])
}

export type CleanupProfileGroup = {
  id: string
  characterKey: CleanupCharacterKey
  profiles: CleanupBuildProfile[]
}

export function cleanupProfileGroups(
  config: ArtifactCleanupConfig,
  covered = new Set<string>()
): CleanupProfileGroup[] {
  const groups = new Map<string, CleanupProfileGroup>()
  for (const state of config.profiles) {
    const profile = resolveCleanupProfile(state)
    if (
      !profile.active ||
      state.stale ||
      covered.has(profile.id) ||
      config.characterCoverage[profile.characterKey] === 'notRelevant'
    )
      continue
    // Prefix even explicit groups with the character: never merge character demand.
    const id = `${profile.characterKey}:${config.profileGroups[profile.id] ?? suggestedCleanupGroup(profile)}`
    const group = groups.get(id) ?? {
      id,
      characterKey: profile.characterKey,
      profiles: [],
    }
    group.profiles.push(profile)
    groups.set(id, group)
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id))
}
