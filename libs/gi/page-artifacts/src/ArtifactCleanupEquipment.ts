import {
  type ArtifactSetKey,
  type ArtifactSlotKey,
  allArtifactSlotKeys,
  charKeyToLocCharKey,
  isCharacterKey,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtifactCleanupConfig,
  CleanupBuildProfile,
  CleanupCharacterKey,
  ICachedArtifact,
} from '@genshin-optimizer/gi/db'
import type {
  CleanupIncompleteEquipment,
  CleanupProfileMatch,
} from './ArtifactCleanup.types'
import type { CleanupProfileGroup } from './ArtifactCleanupGroups'

type Assignment = {
  match: CleanupProfileMatch
  reason: 'equipment' | 'reserve'
}
type Edge = {
  artifact: ICachedArtifact
  match: CleanupProfileMatch
  preferred: number
  protected: boolean
}
type Pattern = Partial<Record<ArtifactSlotKey, ArtifactSetKey>>

function patterns(profile: CleanupBuildProfile): Pattern[] {
  const result: Pattern[] = []
  for (const set of profile.setTargets.fourPieceSets)
    for (const off of allArtifactSlotKeys)
      result.push(
        Object.fromEntries(
          allArtifactSlotKeys
            .filter((slot) => slot !== off)
            .map((slot) => [slot, set])
        )
      )
  const options = profile.setTargets.halfSetOptions
  const pairs =
    options?.length === 2
      ? options[0].flatMap((a) =>
          options[1].filter((b) => b !== a).map((b) => [a, b] as const)
        )
      : profile.setTargets.halfSets.flatMap((a, i, sets) =>
          sets.slice(i + 1).map((b) => [a, b] as const)
        )
  for (const [a, b] of pairs) {
    if (a === b) {
      for (const off of allArtifactSlotKeys)
        result.push(
          Object.fromEntries(
            allArtifactSlotKeys
              .filter((slot) => slot !== off)
              .map((slot) => [slot, a])
          )
        )
      continue
    }
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++) {
        const rest = allArtifactSlotKeys.filter((_, k) => k !== i && k !== j)
        for (let k = 0; k < rest.length; k++)
          for (let l = k + 1; l < rest.length; l++)
            result.push({
              [allArtifactSlotKeys[i]]: a,
              [allArtifactSlotKeys[j]]: a,
              [rest[k]]: b,
              [rest[l]]: b,
            })
      }
  }
  return result
}

/** Select coherent equipment before filling spare slots. A group chooses one
 * complete profile/set alternative. Partial selections retain their exact gaps.
 * Alternative playstyles of one character may reuse compatible equipment. */
export async function allocateCleanupEquipment({
  groups,
  edges,
  config,
  referenced,
  shouldCancel,
}: {
  groups: CleanupProfileGroup[]
  edges: Edge[]
  config: ArtifactCleanupConfig
  referenced: Set<string>
  shouldCancel: () => boolean
}) {
  const assigned = new Map<string, Assignment>()
  const owner = new Map<string, CleanupCharacterKey>()
  const incompleteGroups: CleanupIncompleteEquipment[] = []
  const byProfile = new Map<string, Edge[]>()
  for (const edge of edges) {
    const pool = byProfile.get(edge.match.profileId) ?? []
    pool.push(edge)
    byProfile.set(edge.match.profileId, pool)
  }
  const candidates = (profile: CleanupBuildProfile) =>
    (byProfile.get(profile.id) ?? []).filter(({ artifact }) => {
      if (
        owner.has(artifact.id) &&
        owner.get(artifact.id) !== profile.characterKey
      )
        return false
      return (
        !artifact.location ||
        artifact.location ===
          (isCharacterKey(profile.characterKey)
            ? charKeyToLocCharKey(profile.characterKey)
            : profile.characterKey)
      )
    })
  const scarcity = (group: CleanupProfileGroup) =>
    new Set(
      group.profiles.flatMap((profile) =>
        candidates(profile).map(({ artifact }) => artifact.id)
      )
    ).size
  // Scarce demands go first, so a flexible piece isn't spent where alternatives exist.
  const ordered = [...groups].sort(
    (a, b) => scarcity(a) - scarcity(b) || a.id.localeCompare(b.id)
  )
  for (const group of ordered) {
    if (shouldCancel()) throw new Error('Cleanup cancelled')
    let best:
      | {
          edges: Edge[]
          count: number
          protected: number
          score: number
          profile: CleanupBuildProfile
        }
      | undefined
    for (const profile of group.profiles) {
      const pool = candidates(profile)
      const bySlot = new Map(
        allArtifactSlotKeys.map((slot) => [
          slot,
          pool.filter(({ artifact }) => artifact.slotKey === slot),
        ])
      )
      for (const pattern of patterns(profile)) {
        const chosen = allArtifactSlotKeys.flatMap((slot) => {
          const edge = bySlot
            .get(slot)!
            .find(
              ({ artifact }) =>
                !pattern[slot] || artifact.setKey === pattern[slot]
            )
          return edge ? [edge] : []
        })
        const option = {
          edges: chosen,
          count: chosen.length,
          protected: chosen.filter((edge) => edge.protected).length,
          score: chosen.reduce((sum, { match }) => sum + match.score, 0),
          profile,
        }
        if (
          !best ||
          option.count > best.count ||
          (option.count === best.count &&
            (option.protected > best.protected ||
              (option.protected === best.protected &&
                option.score > best.score)))
        )
          best = option
      }
    }
    if (best)
      for (const edge of best.edges) {
        owner.set(edge.artifact.id, group.characterKey)
        assigned.set(edge.artifact.id, {
          match: edge.match,
          reason: 'equipment',
        })
      }
    const missing = allArtifactSlotKeys.filter(
      (slot) => !best?.edges.some(({ artifact }) => artifact.slotKey === slot)
    )
    if (missing.length)
      incompleteGroups.push({
        id: group.id,
        characterKey: group.characterKey,
        profileName: best?.profile.name ?? group.profiles[0]?.name ?? '',
        missingSlots: missing,
      })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  const reserveCounts = new Map<string, number>()
  const byId = new Map(
    groups.flatMap((group) =>
      group.profiles.map((profile) => [profile.id, { group, profile }] as const)
    )
  )
  const signatures = new Map<string, string>()
  for (const group of groups) {
    const alternatives = group.profiles.map((profile) =>
      JSON.stringify([
        [...profile.setTargets.fourPieceSets].sort(),
        [...profile.setTargets.halfSets].sort(),
        profile.setTargets.halfSetOptions,
        ...(['sands', 'goblet', 'circlet'] as const).map((slot) =>
          Object.entries(profile.mainStatWeights[slot] ?? {}).sort(([a], [b]) =>
            a.localeCompare(b)
          )
        ),
        Object.entries(profile.substatWeights).sort(([a], [b]) =>
          a.localeCompare(b)
        ),
        profile.mustPresentWeightThreshold,
        profile.substatWeightThreshold,
        profile.kOverride,
      ])
    )
    const signature = JSON.stringify([...new Set(alternatives)].sort())
    signatures.set(group.id, signature)
  }
  // Compatible characters and set alternatives share the same extra reserve.
  for (const edge of edges) {
    const { artifact, match } = edge
    if (
      assigned.has(artifact.id) ||
      artifact.location ||
      referenced.has(artifact.id)
    )
      continue
    const entry = byId.get(match.profileId)
    if (
      !entry ||
      ![
        ...entry.profile.setTargets.fourPieceSets,
        ...entry.profile.setTargets.halfSets,
      ].includes(artifact.setKey)
    )
      continue
    const key = `${artifact.slotKey}:${signatures.get(entry.group.id)}`
    const count = reserveCounts.get(key) ?? 0
    if (count >= config.demandMargin) continue
    reserveCounts.set(key, count + 1)
    assigned.set(artifact.id, { match, reason: 'reserve' })
  }
  return { assigned, incompleteGroups }
}

export type { Edge as CleanupEquipmentEdge }
