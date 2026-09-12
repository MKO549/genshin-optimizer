import {
  notEmpty,
  objKeyMap,
  objPathValue,
} from '@genshin-optimizer/common/util'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ArtSetExclusionKey,
  ICachedArtifact,
  ICachedWeapon,
  LoadoutDatum,
  OptConfig,
} from '@genshin-optimizer/gi/db'
import { getTeamData, resolveInfo } from '@genshin-optimizer/gi/ui'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { UpOptCalculatorV2 } from '@genshin-optimizer/gi/upopt'
import { matchesStrongOffPieceRule } from '@genshin-optimizer/gi/util'
import type { NumNode } from '@genshin-optimizer/gi/wr'
import { dynamicData, mergeData, optimize } from '@genshin-optimizer/gi/wr'

export type CleanupSkipReason =
  | 'missingTarget'
  | 'incompleteBuild'
  | 'theorycraftBuild'
  | 'invalidData'

export type CleanupLoadout = {
  id: string
  characterKey: CharacterKey
  teamName: string
  characterName: string
  buildName: string
  reason?: CleanupSkipReason
}

export type CleanupUpgradeMatch = CleanupLoadout & {
  probability: number
  averageIncrease: number
}

export type ArtifactSetCleanupResult = {
  selectedCount: number
  eligibleIds: string[]
  protectedCount: number
  offPieceIds: string[]
  upgradeIds: string[]
  upgradeMatches: Record<string, CleanupUpgradeMatch[]>
  safeIds: string[]
  analyzedLoadouts: CleanupLoadout[]
  skippedLoadouts: CleanupLoadout[]
}

type Progress = { current: number; total: number }
export type ArtifactSetCleanupThresholds = {
  minProbability: number
  minAverageIncrease: number
  protectOffPieces: boolean
}

/**
 * Applies the same one-artifact replacement semantics as the Artifact Upgrader
 * to every complete equipped or saved build currently using the selected set,
 * in each matching configured team context.
 */
export async function analyzeArtifactSetCleanup(
  database: ArtCharDatabase,
  setKey: ArtifactSetKey,
  thresholds: ArtifactSetCleanupThresholds = {
    minProbability: 0,
    minAverageIncrease: 0,
    protectOffPieces: true,
  },
  onProgress?: (progress: Progress) => void
): Promise<ArtifactSetCleanupResult> {
  const minProbability = Number.isFinite(thresholds.minProbability)
    ? Math.min(100, Math.max(0, thresholds.minProbability))
    : 0
  const minAverageIncrease = Number.isFinite(thresholds.minAverageIncrease)
    ? Math.max(0, thresholds.minAverageIncrease)
    : 0
  const selected = database.arts.values.filter((art) => art.setKey === setKey)
  const referencedByBuild = new Set(
    database.builds.values.flatMap((build) =>
      Object.values(build.artifactIds).filter(notEmpty)
    )
  )
  const cleanupCandidates = selected.filter(
    (art) =>
      art.rarity === 5 &&
      art.level < 20 &&
      art.lock &&
      !art.location &&
      !referencedByBuild.has(art.id)
  )
  const offPieceIds = thresholds.protectOffPieces
    ? cleanupCandidates.filter(matchesStrongOffPieceRule).map(({ id }) => id)
    : []
  const offPieceIdSet = new Set(offPieceIds)
  const eligible = cleanupCandidates.filter(({ id }) => !offPieceIdSet.has(id))

  const loadouts = database.teams.entries.flatMap(([teamId, team]) =>
    team.loadoutData.flatMap((loadoutDatum) => {
      if (!loadoutDatum) return []
      const teamChar = database.teamChars.get(loadoutDatum.teamCharId)
      if (!teamChar) return []
      const optConfig = database.optConfigs.get(teamChar.optConfigId)
      const variants = getBuildVariants(database, loadoutDatum, teamChar.key)
      return variants
        .filter(({ build }) => {
          const setCount = Object.values(build).filter(
            (art) => art?.setKey === setKey
          ).length
          return setCount >= 2 || optConfig?.forcedArtifactSet === setKey
        })
        .map((variant) => ({
          teamId,
          team,
          teamChar,
          loadoutDatum,
          optConfig,
          ...variant,
        }))
    })
  )

  const analyzedLoadouts: CleanupLoadout[] = []
  const skippedLoadouts: CleanupLoadout[] = []
  const upgradeIds = new Set<string>()
  const upgradeMatches: Record<string, CleanupUpgradeMatch[]> = {}
  onProgress?.({ current: 0, total: loadouts.length })

  for (let index = 0; index < loadouts.length; index++) {
    const {
      teamId,
      team,
      teamChar,
      loadoutDatum,
      build,
      buildId,
      buildName,
      buildType,
      weapon,
      optConfig,
    } = loadouts[index]
    const label = {
      id: `${teamId}:${loadoutDatum.teamCharId}:${buildId}`,
      characterKey: teamChar.key,
      teamName: team.name,
      characterName: teamChar.name,
      buildName,
    }
    const reason = getSkipReason(buildType, build, optConfig)
    if (reason) skippedLoadouts.push({ ...label, reason })
    else {
      const calculator = createCalculator(
        database,
        teamId,
        loadoutDatum.teamCharId,
        teamChar.key,
        build,
        optConfig!,
        eligible,
        weapon
      )
      if (!calculator) skippedLoadouts.push({ ...label, reason: 'invalidData' })
      else {
        analyzedLoadouts.push(label)
        calculator.candidates.forEach(({ info, result }) => {
          if (info.type !== 'levelUp') return
          const probability = result.p * 100
          const currentTarget = calculator.obj.threshold[0]
          const averageIncrease =
            currentTarget === 0 ? 0 : (result.upAvg * 100) / currentTarget
          if (
            probability < minProbability ||
            averageIncrease < minAverageIncrease
          )
            return
          upgradeIds.add(info.artifactId)
          const matches = upgradeMatches[info.artifactId] ?? []
          if (!matches.some(({ id }) => id === label.id))
            matches.push({ ...label, probability, averageIncrease })
          upgradeMatches[info.artifactId] = matches
        })
      }
    }
    onProgress?.({ current: index + 1, total: loadouts.length })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  const canClassify =
    analyzedLoadouts.length > 0 && skippedLoadouts.length === 0
  return {
    selectedCount: selected.length,
    eligibleIds: eligible.map(({ id }) => id),
    protectedCount: selected.length - eligible.length,
    offPieceIds,
    upgradeIds: [...upgradeIds],
    upgradeMatches,
    safeIds: canClassify
      ? eligible.map(({ id }) => id).filter((id) => !upgradeIds.has(id))
      : [],
    analyzedLoadouts,
    skippedLoadouts,
  }
}

type BuildVariant = {
  buildId: string
  buildName: string
  buildType: 'equipped' | 'saved' | 'tc'
  build: Record<ArtifactSlotKey, ICachedArtifact | undefined>
  weapon?: ICachedWeapon
}

function getBuildVariants(
  database: ArtCharDatabase,
  loadoutDatum: LoadoutDatum,
  characterKey: CharacterKey
): BuildVariant[] {
  const variants: BuildVariant[] = []
  const includedBuildIds = new Set<string>()

  if (loadoutDatum.buildType === 'equipped') {
    variants.push({
      buildId: 'equipped',
      buildName: 'Equipped',
      buildType: 'equipped',
      build: database.teams.getLoadoutArtifacts(loadoutDatum),
    })
  } else if (loadoutDatum.buildType === 'tc') {
    variants.push({
      buildId: `tc:${loadoutDatum.buildTcId}`,
      buildName:
        database.buildTcs.get(loadoutDatum.buildTcId)?.name ?? 'Theorycraft',
      buildType: 'tc',
      build: database.teams.getLoadoutArtifacts(loadoutDatum),
    })
  }

  database.builds.entriesForCharacter(characterKey).forEach(([id, saved]) => {
    if (includedBuildIds.has(id)) return
    includedBuildIds.add(id)
    variants.push({
      buildId: `saved:${id}`,
      buildName: saved.name,
      buildType: 'saved',
      build: objKeyMap(allArtifactSlotKeys, (slotKey) =>
        database.arts.get(saved.artifactIds[slotKey])
      ),
      weapon: database.weapons.get(saved.weaponId),
    })
  })

  return variants
}

function getSkipReason(
  buildType: BuildVariant['buildType'],
  build: Record<ArtifactSlotKey, ICachedArtifact | undefined>,
  optConfig: OptConfig | undefined
): CleanupSkipReason | undefined {
  if (buildType === 'tc') return 'theorycraftBuild'
  if (!Object.values(build).every(Boolean)) return 'incompleteBuild'
  if (!optConfig?.optimizationTarget) return 'missingTarget'
  return undefined
}

function createCalculator(
  database: ArtCharDatabase,
  teamId: string,
  teamCharId: string,
  characterKey: CharacterKey,
  build: Record<ArtifactSlotKey, ICachedArtifact | undefined>,
  optConfig: OptConfig,
  artifacts: ICachedArtifact[],
  weapon?: ICachedWeapon
) {
  const activeCharKey = database.teams.getActiveTeamChar(teamId)?.key
  const teamData = getTeamData(database, teamId, teamCharId, 0, [], weapon)
  if (!activeCharKey || !teamData) return undefined

  const workerData = uiDataForTeam(
    teamData.teamData,
    database.gender,
    activeCharKey
  )[characterKey]?.target.data[0]
  if (!workerData || !optConfig.optimizationTarget) return undefined
  Object.assign(workerData, mergeData([workerData, dynamicData]))

  const optimizationTarget = objPathValue(
    workerData.display ?? {},
    optConfig.optimizationTarget
  ) as NumNode | undefined
  if (!optimizationTarget) return undefined

  const valueFilter = Object.entries(optConfig.statFilters).flatMap(
    ([pathStr, settings]) =>
      settings
        .filter(({ disabled }) => !disabled)
        .flatMap((setting) => {
          const value = objPathValue(
            workerData.display ?? {},
            JSON.parse(pathStr)
          ) as NumNode | undefined
          if (!value) return []
          const info = value.info && resolveInfo(value.info)
          const minimum =
            info?.unit === '%' ? setting.value / 100 : setting.value
          return [{ value, minimum }]
        })
  )

  const candidates = artifacts.filter((art) => {
    if (!optConfig.useExcludedArts && optConfig.artExclusion.includes(art.id))
      return false
    if (
      art.slotKey !== 'flower' &&
      art.slotKey !== 'plume' &&
      !optConfig.mainStatKeys[art.slotKey].includes(art.mainStatKey)
    )
      return false
    if (
      art.location &&
      art.location !== charKeyToLocCharKey(characterKey) &&
      optConfig.excludedLocations.includes(art.location)
    )
      return false
    if (
      art.level < optConfig.upOptLevelLow ||
      art.level > optConfig.upOptLevelHigh
    )
      return false
    return respectsSetExclusion(art, build, optConfig)
  })

  const nodes = optimize(
    [optimizationTarget, ...valueFilter.map(({ value }) => value)],
    workerData,
    ({ path: [path] }) => path !== 'dyn'
  )
  return new UpOptCalculatorV2(
    nodes,
    [Number.NEGATIVE_INFINITY, ...valueFilter.map(({ minimum }) => minimum)],
    build,
    candidates,
    { enabled: false, minTotal: 2 },
    {
      enabled: false,
      setSlotMainStatKeys: objKeyMap(allArtifactSlotKeys, () => ({
        setKeys: [],
        mainStats: [],
      })),
      substats: [],
    }
  )
}

function respectsSetExclusion(
  artifact: ICachedArtifact,
  build: Record<ArtifactSlotKey, ICachedArtifact | undefined>,
  optConfig: OptConfig
) {
  const setKeys = objKeyMap(
    allArtifactSlotKeys,
    (slotKey) => build[slotKey]?.setKey
  )
  setKeys[artifact.slotKey] = artifact.setKey
  const counts: Partial<Record<ArtifactSetKey, number>> = {}
  Object.values(setKeys).forEach((key) => {
    if (!key || key.startsWith('Prayers')) return
    counts[key] = (counts[key] ?? 0) + 1
  })

  const allowed = Object.entries(counts).every(([key, count]) => {
    const excluded = optConfig.artSetExclusion[key as ArtSetExclusionKey]
    if (!excluded || count < 2) return true
    return count < 4 ? !excluded.includes(2) : !excluded.includes(4)
  })
  if (!allowed || !optConfig.artSetExclusion.rainbow) return allowed

  const rainbow = Object.values(counts).reduce(
    (total, count) => total + (count % 2),
    0
  )
  return rainbow < 2
    ? true
    : rainbow < 4
      ? !optConfig.artSetExclusion.rainbow.includes(2)
      : !optConfig.artSetExclusion.rainbow.includes(4)
}
