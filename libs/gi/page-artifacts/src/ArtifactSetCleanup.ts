import {
  notEmpty,
  objKeyMap,
  objPathValue,
} from '@genshin-optimizer/common/util'
import {
  type ArtifactSetKey,
  type ArtifactSlotKey,
  allArtifactSlotKeys,
  type CharacterKey,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ArtifactCleanupConfig,
  CleanupBuildProfile,
  CleanupCharacterKey,
  ICachedArtifact,
  ICachedWeapon,
  LoadoutDatum,
  OptConfig,
} from '@genshin-optimizer/gi/db'
import type { ArtifactBuildData } from '@genshin-optimizer/gi/solver'
import { compactArtifacts } from '@genshin-optimizer/gi/solver-tc'
import { getTeamData, resolveInfo } from '@genshin-optimizer/gi/ui'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { UpOptCalculatorV2 } from '@genshin-optimizer/gi/upopt'
import {
  dynamicData,
  mergeData,
  type NumNode,
  type OptNode,
  optimize,
  precompute,
} from '@genshin-optimizer/gi/wr'
import {
  type ArtifactCleanupResult,
  type CleanupArtifactResult,
  type CleanupGOEvidence,
  type CleanupLoadout,
  type CleanupProgress,
  type CleanupSkipReason,
  cleanupRecommendations,
} from './ArtifactCleanup.types'
import { cleanupRelevantCharacters } from './ArtifactCleanupProfiles'
import {
  type CleanupTopProblem,
  cleanupAllowedSets,
} from './ArtifactCleanupTopBuilds'
import {
  runCleanupProfiles,
  runCleanupTopBuilds,
} from './ArtifactCleanupWorkerClient.mjs'

export * from './ArtifactCleanup.types'

/** Capture all inputs that can change a recommendation; display filters aren't inputs. */
export function artifactCleanupSnapshot(
  database: ArtCharDatabase,
  config = database.artifactCleanup.get()
) {
  return JSON.stringify([
    config,
    database.gender,
    database.arts.entries,
    database.chars.entries,
    database.weapons.entries,
    database.builds.entries,
    database.buildTcs.entries,
    database.teams.entries,
    database.teamChars.entries,
    database.optConfigs.entries,
    database.charMeta.entries,
  ])
}
export function cleanupReferencedArtifacts(database: ArtCharDatabase) {
  return new Set(
    database.builds.values.flatMap((build) =>
      Object.values(build.artifactIds).filter(notEmpty)
    )
  )
}

type CleanupContext = ReturnType<typeof cleanupContexts>[number]
function cleanupContexts(
  database: ArtCharDatabase,
  relevant?: Set<CleanupCharacterKey>,
  coverage = database.artifactCleanup.get().goProfileCoverage
) {
  const confirmed = new Set(Object.values(coverage).flat())
  return database.teams.entries.flatMap(([teamId, team]) =>
    team.loadoutData.flatMap((datum) => {
      if (!datum) return []
      const teamChar = database.teamChars.get(datum.teamCharId)
      if (!teamChar || (relevant && !relevant.has(teamChar.key))) return []
      return getBuildVariants(database, datum, teamChar.key, (buildId) =>
        confirmed.has([teamId, datum.teamCharId, buildId].join(':'))
      ).map((variant) => ({
        teamId,
        team,
        datum,
        teamChar,
        optConfig: database.optConfigs.get(teamChar.optConfigId),
        ...variant,
        label: {
          id: [teamId, datum.teamCharId, variant.buildId].join(':'),
          characterKey: teamChar.key,
          teamName: team.name,
          characterName: teamChar.name,
          buildName: variant.buildName,
        } as CleanupLoadout,
      }))
    })
  )
}

/** Everything that feeds the optimizer for one build. Identical fingerprints
 * produce identical top builds, so duplicated teams are analyzed once. */
function contextFingerprint(
  database: ArtCharDatabase,
  context: CleanupContext
) {
  const { team, datum, optConfig, build, weapon } = context
  const members = team.loadoutData.map((member) => {
    if (!member) return null
    const teamChar = database.teamChars.get(member.teamCharId)
    if (!teamChar) return null
    // Names and ids differ between copies without changing the calculation.
    const {
      id: _id,
      name: _name,
      description: _description,
      optConfigId: _opt,
      ...rest
    } = teamChar as typeof teamChar & { id?: string }
    const own = member.teamCharId === datum.teamCharId
    return [
      rest,
      member.buildType === 'tc' ? `tc:${member.buildTcId}` : member.buildType,
      own
        ? allArtifactSlotKeys.map((slot) => build[slot]?.id)
        : Object.values(database.teams.getLoadoutArtifactIds(member)),
      own ? weapon?.id : database.teams.getLoadoutWeaponId(member),
    ]
  })
  return JSON.stringify([
    team.enemyOverride,
    team.conditional,
    members,
    optConfig && [
      optConfig.optimizationTarget,
      optConfig.statFilters,
      optConfig.mainStatKeys,
      optConfig.artSetExclusion,
      optConfig.forcedArtifactSet,
      optConfig.excludedLocations,
      optConfig.artExclusion,
      optConfig.useExcludedArts,
      optConfig.useTeammateBuild,
    ],
  ])
}
function groupCleanupContexts(
  database: ArtCharDatabase,
  contexts: CleanupContext[]
) {
  const groups = new Map<string, CleanupContext>()
  for (const context of contexts) {
    const key = contextFingerprint(database, context)
    const primary = groups.get(key)
    if (!primary) {
      groups.set(key, context)
      continue
    }
    const { id, teamName, buildName } = context.label
    primary.label.duplicates = [
      ...(primary.label.duplicates ?? []),
      { id, teamName, buildName },
    ]
  }
  return [...groups.values()]
}

export function cleanupLoadoutOptions(
  database: ArtCharDatabase
): CleanupLoadout[] {
  return cleanupContexts(database).map(
    ({ label, buildType, build, optConfig }) => ({
      ...label,
      reason: getSkipReason(buildType, build, optConfig),
    })
  )
}

/** Deduplicated builds for the cleanup run, with a suggestion for the chosen sets. */
export function cleanupLoadoutSelectionOptions(
  database: ArtCharDatabase,
  setKeys: readonly ArtifactSetKey[]
): (CleanupLoadout & { suggested: boolean })[] {
  return groupCleanupContexts(database, cleanupContexts(database)).map(
    (context) => {
      const { label, buildType, build, optConfig } = context
      const reason = getSkipReason(buildType, build, optConfig)
      return {
        ...label,
        reason,
        suggested: !reason && cleanupLoadoutSuggested(context, setKeys),
      }
    }
  )
}

/** A build is suggested when it already wears a chosen set, or when its
 * optimizer settings allow a chosen set as a 2- or 4-piece bonus. */
function cleanupLoadoutSuggested(
  { build, optConfig }: CleanupContext,
  setKeys: readonly ArtifactSetKey[]
) {
  if (allArtifactSlotKeys.some((slot) => setKeys.includes(build[slot]!.setKey)))
    return true
  if (!optConfig) return false
  return setKeys.some((set) => {
    if (optConfig.forcedArtifactSet && optConfig.forcedArtifactSet !== set)
      return false
    const excluded =
      optConfig.artSetExclusion[set as keyof OptConfig['artSetExclusion']] ?? []
    return !(excluded.includes(2) && excluded.includes(4))
  })
}

export function cleanupSelectedLoadoutIds(
  database: ArtCharDatabase,
  config: ArtifactCleanupConfig = database.artifactCleanup.get()
) {
  return new Set(
    config.selectedLoadoutIds ??
      cleanupLoadoutSelectionOptions(database, config.selectedSetKeys)
        .filter(({ suggested }) => suggested)
        .map(({ id }) => id)
  )
}

export function cleanupSuggestedLoadoutIds(
  database: ArtCharDatabase,
  profile: CleanupBuildProfile
) {
  return new Set(
    cleanupContexts(database)
      .filter(({ label, build, buildType, optConfig }) => {
        if (
          label.characterKey !== profile.characterKey ||
          getSkipReason(buildType, build, optConfig)
        )
          return false
        if (
          !(['sands', 'goblet', 'circlet'] as const).every(
            (slot) =>
              (profile.mainStatWeights[slot]?.[build[slot]!.mainStatKey] ?? 0) >
              0
          )
        )
          return false
        const sets = Object.values(build)
          .filter(notEmpty)
          .map(({ setKey }) => setKey)
        return (
          profile.setTargets.fourPieceSets.some(
            (set) => sets.filter((key) => key === set).length >= 4
          ) ||
          profile.setTargets.halfSets.some(
            (set) => sets.filter((key) => key === set).length >= 2
          )
        )
      })
      .map(({ label }) => label.id)
  )
}

/** Statuses that settle a piece for one build without any manual review. */
const conclusiveStatuses: CleanupGOEvidence['status'][] = [
  'topBuild',
  'notInTop',
  'belowCurrent',
  'upgradeChance',
  'mainStatExcluded',
  'setExcluded',
  'locationExcluded',
]

export async function analyzeArtifactCleanup(
  database: ArtCharDatabase,
  config: ArtifactCleanupConfig = database.artifactCleanup.get(),
  {
    onProgress,
    shouldCancel = () => false,
  }: {
    onProgress?: (progress: CleanupProgress) => void
    shouldCancel?: () => boolean
  } = {}
): Promise<ArtifactCleanupResult> {
  if (!config.selectedSetKeys.length)
    throw new Error('Select artifact sets before analyzing')
  const snapshot = artifactCleanupSnapshot(database, config)
  const databaseSnapshot = artifactCleanupSnapshot(database)
  const inventory = [...database.arts.values]
  const artifacts = inventory.filter((art) =>
    config.selectedSetKeys.includes(art.setKey)
  )
  const referenced = cleanupReferencedArtifacts(database)
  const teamCharacters = database.teamChars.values.map(({ key }) => key)
  const relevantCharacters = cleanupRelevantCharacters(
    [
      ...new Set([
        ...database.chars.values.map(({ key }) => key),
        ...teamCharacters,
      ]),
    ],
    config,
    teamCharacters
  )
  const checkCancelled = () => {
    if (shouldCancel()) throw new Error('Cleanup cancelled')
  }
  const rows: CleanupArtifactResult[] = artifacts.map((art) => ({
    id: art.id,
    setKey: art.setKey,
    slotKey: art.slotKey,
    level: art.level,
    recommendation: 'review',
    reasons: [],
    characterKeys: [],
    profileMatches: [],
    reservedFor: [],
    goEvidence: [],
    issues: [],
    priority: 0,
  }))
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const candidates = artifacts.filter(
    (art) => art.rarity === 5 && !art.location && !referenced.has(art.id)
  )
  const selectedLoadoutIds = cleanupSelectedLoadoutIds(database, config)
  const groups = groupCleanupContexts(
    database,
    cleanupContexts(
      database,
      new Set(relevantCharacters),
      config.goProfileCoverage
    )
  )
  const loadouts = groups.filter(({ label }) =>
    [label.id, ...(label.duplicates ?? []).map(({ id }) => id)].some((id) =>
      selectedLoadoutIds.has(id)
    )
  )
  // Characters whose builds were all deselected are a deliberate user choice,
  // not missing coverage. JSON reserves still apply to them.
  const deselectedCharacters = new Set(
    groups
      .filter(({ label }) => !loadouts.some((item) => item.label === label))
      .map(({ label }) => label.characterKey)
      .filter(
        (key) => !loadouts.some(({ label }) => label.characterKey === key)
      )
  )
  const analyzedLoadouts: CleanupLoadout[] = []
  const skippedLoadouts: CleanupLoadout[] = []
  const successful = new Set<string>()
  onProgress?.({ phase: 'builds', current: 0, total: loadouts.length })
  for (let index = 0; index < loadouts.length; index++) {
    checkCancelled()
    const context = loadouts[index]
    const { label, buildType, build, optConfig, teamId, teamChar } = context
    const report = (progress: Partial<CleanupProgress> = {}) =>
      onProgress?.({
        phase: 'builds',
        current: index,
        total: loadouts.length,
        loadout: label,
        ...progress,
      })
    report({ searchStage: 'optimizing' })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    checkCancelled()
    let reason = getSkipReason(buildType, build, optConfig)
    let problem: CleanupProblem | undefined
    if (!reason) {
      try {
        const prepared = createCleanupProblem(
          database,
          teamId,
          context.datum.teamCharId,
          teamChar.key,
          build,
          optConfig!,
          inventory,
          candidates,
          config.topN,
          context.weapon
        )
        if (typeof prepared === 'string') reason = prepared
        else problem = prepared
      } catch {
        reason = 'invalidData'
      }
    }
    if (reason || !problem) {
      // The character's GO coverage is missing; JSON coverage decides instead.
      label.reason = reason ?? 'invalidData'
      skippedLoadouts.push(label)
      report()
      continue
    }
    for (const art of candidates)
      if (!problem.eligibleIds.has(art.id))
        rowById.get(art.id)!.goEvidence.push({
          loadout: label,
          status:
            cleanupCandidateExclusion(
              art,
              build,
              optConfig!,
              database,
              teamId,
              context.datum.teamCharId
            ) ?? 'artifactExcluded',
        })
    try {
      const top = await runCleanupTopBuilds(problem.top, {
        shouldCancel,
        maxMs: config.maxLoadoutSeconds * 1000,
        onProgress: ({ elapsedMs, tested }) =>
          report({
            searchStage: 'optimizing',
            searchElapsedMs: elapsedMs,
            searchTested: tested,
          }),
      })
      checkCancelled()
      if (top.complete && !top.builds.length) {
        // No outfit meets the optimizer's minimum stats: a settings problem.
        label.reason = 'noFeasibleBuild'
        skippedLoadouts.push(label)
        report({ current: index + 1 })
        continue
      }
      // Only builds that beat the current one show a use for a piece.
      const ranks = new Map<string, number>()
      const below = new Map<string, number>()
      top.builds.forEach(({ artifactIds, value }, rank) =>
        artifactIds.forEach((id) => {
          const target = value > problem!.threshold ? ranks : below
          if (!target.has(id)) target.set(id, rank)
        })
      )
      const topValue = top.builds[0]?.value
      const reference = top.builds[0]
        ? (objKeyMap(allArtifactSlotKeys, (slot) =>
            top.builds[0].artifactIds
              .map((id) => database.arts.get(id))
              .find((art) => art?.slotKey === slot)
          ) as Build)
        : build
      const upgrader = createUpgrader(problem, reference)
      const eligible = candidates.filter(({ id }) =>
        problem!.eligibleIds.has(id)
      )
      for (let current = 0; current < eligible.length; current++) {
        const art = eligible[current]
        if (current % 16 === 0) {
          report({
            searchStage: 'upgrading',
            candidateCurrent: current,
            candidateTotal: eligible.length,
          })
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          checkCancelled()
        }
        const evidence: CleanupGOEvidence = {
          loadout: label,
          status: 'notInTop',
          baseline: problem.baseline,
          topValue,
          accuracy: 'exact',
          upgrade: false,
        }
        const rank = ranks.get(art.id)
        if (rank !== undefined) {
          const { value, artifactIds } = top.builds[rank]
          Object.assign(evidence, {
            status: 'topBuild',
            upgrade: true,
            rank: rank + 1,
            bestValue: value,
            artifactIds,
            ...increase(value, problem.baseline),
          })
        } else {
          if (!top.complete && top.remainingIds.has(art.id))
            evidence.status = 'searchLimit'
          else if (below.has(art.id)) {
            const index = below.get(art.id)!
            Object.assign(evidence, {
              status: 'belowCurrent',
              rank: index + 1,
              bestValue: top.builds[index].value,
            })
          }
          const chance =
            art.level < 20 &&
            upgrader &&
            evaluateUpgrade(upgrader, art, reference, problem, config)
          if (chance) {
            const value = chance.currentValue + chance.averageIncrease
            Object.assign(evidence, {
              status: 'upgradeChance',
              accuracy: 'estimated',
              probability: chance.probability,
              bestValue: value,
              ...increase(value, chance.currentValue),
            })
          }
        }
        rowById.get(art.id)!.goEvidence.push(evidence)
      }
      if (top.complete) {
        for (const id of [
          label.id,
          ...(label.duplicates ?? []).map(({ id }) => id),
        ])
          successful.add(id)
        analyzedLoadouts.push(label)
      } else {
        label.reason = 'searchLimit'
        skippedLoadouts.push(label)
      }
    } catch {
      checkCancelled()
      for (const art of candidates) {
        const row = rowById.get(art.id)!
        row.goEvidence = row.goEvidence.filter(
          ({ loadout }) => loadout.id !== label.id
        )
        row.goEvidence.push({ loadout: label, status: 'invalidData' })
      }
      label.reason = 'invalidData'
      skippedLoadouts.push(label)
    }
    report({ current: index + 1 })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  checkCancelled()
  const profileCoverage = config.profiles.map(({ base }) => ({
    profileId: base.id,
    loadoutIds: config.goProfileCoverage[base.id] ?? [],
    covered: (config.goProfileCoverage[base.id] ?? []).some(
      (id) =>
        successful.has(id) &&
        groups.some(
          ({ label }) =>
            label.characterKey === base.characterKey &&
            (label.id === id ||
              label.duplicates?.some((duplicate) => duplicate.id === id))
        )
    ),
  }))
  const coveredProfileIds = new Set(
    profileCoverage
      .filter(({ covered }) => covered)
      .map(({ profileId }) => profileId)
  )
  const profiles = await runCleanupProfiles({
    artifacts: inventory,
    config,
    relevantCharacters,
    referencedArtifactIds: referenced,
    coveredProfileIds,
    shouldCancel,
    onProgress: (current, total) =>
      onProgress?.({ phase: 'profiles', current, total }),
  })
  checkCancelled()
  const coveredByGO = new Set(
    analyzedLoadouts.map(({ characterKey }) => characterKey)
  )
  const coverageMissing = relevantCharacters.filter(
    (key) =>
      profiles.invalidProfileCharacters.has(key) ||
      (!profiles.coveredCharacters.has(key) &&
        !coveredByGO.has(key) &&
        !deselectedCharacters.has(key as CharacterKey))
  )
  for (const art of artifacts) {
    const row = rowById.get(art.id)!
    row.profileMatches = profiles.matches.get(art.id) ?? []
    const assignment = profiles.assignedMatches.get(art.id)
    if (assignment)
      row.reservedFor.push({
        characterKey: assignment.match.characterKey,
        profileId: assignment.match.profileId,
        reason: assignment.reason,
      })
    if (art.location) row.reasons.push('equipped')
    if (referenced.has(art.id)) row.reasons.push('savedBuild')
    if (art.rarity !== 5) row.reasons.push('rarity')
    row.reasons.push(...(profiles.reservations.get(art.id) ?? []))
    const upgrades = row.goEvidence.filter(({ upgrade }) => upgrade)
    if (upgrades.length) row.reasons.push('upgrade')
    const chances = row.goEvidence.filter(
      ({ status }) => status === 'upgradeChance'
    )
    if (chances.length) row.reasons.push('upgradeChance')
    for (const evidence of row.goEvidence) {
      if (!conclusiveStatuses.includes(evidence.status))
        row.issues.push(
          [
            evidence.loadout.teamName,
            evidence.loadout.buildName,
            evidence.status,
          ].join(' / ')
        )
    }
    if (profiles.invalidArtifactIds.has(art.id)) {
      row.reasons.push('invalidData')
      row.issues.push('invalidArtifact')
    }
    if (
      coverageMissing.length ||
      !relevantCharacters.length ||
      config.importWarnings.length
    ) {
      row.reasons.push('coverage')
      row.issues.push(
        ...coverageMissing,
        ...config.importWarnings,
        ...(!relevantCharacters.length ? ['noCharacters'] : [])
      )
    }
    row.characterKeys = [
      ...new Set([
        ...row.profileMatches.map(({ characterKey }) => characterKey),
        ...row.goEvidence.map(({ loadout }) => loadout.characterKey),
      ]),
    ]
    row.priority = Math.max(
      0,
      ...[...upgrades, ...chances].map(({ priority }) => priority ?? 0)
    )
    if (art.location || referenced.has(art.id) || art.rarity !== 5)
      row.recommendation = 'protected'
    else if (upgrades.length)
      row.recommendation = art.level < 20 ? 'level' : 'keep'
    else if (chances.length) row.recommendation = 'level'
    else if (
      row.reasons.some((reason) =>
        ['equipment', 'reserve', 'pattern', 'floor'].includes(reason)
      )
    )
      row.recommendation = 'keep'
    else if (row.issues.length) row.recommendation = 'review'
    else {
      row.recommendation = 'discard'
      row.reasons.push('noDemand')
    }
    row.reasons = [...new Set(row.reasons)]
  }
  if (databaseSnapshot !== artifactCleanupSnapshot(database))
    throw new Error('Cleanup inputs changed')
  return {
    snapshot,
    artifacts: rows,
    analyzedLoadouts,
    skippedLoadouts,
    coverageMissing,
    profileWarnings: [...profiles.warnings, ...config.importWarnings],
    profileCoverage,
    incompleteGroups: profiles.incompleteGroups,
    selectedSetKeys: [...config.selectedSetKeys],
    counts: Object.fromEntries(
      cleanupRecommendations.map((key) => [
        key,
        rows.filter(({ recommendation }) => recommendation === key).length,
      ])
    ) as ArtifactCleanupResult['counts'],
  }
}

const cleanupTolerance = (value: number) => Math.max(1, Math.abs(value)) * 1e-9

function increase(value: number, baseline: number | undefined) {
  if (baseline === undefined || !Number.isFinite(baseline)) return {}
  const absoluteIncrease = value - baseline
  const averageIncrease =
    baseline === 0 ? undefined : (absoluteIncrease * 100) / Math.abs(baseline)
  return {
    absoluteIncrease,
    averageIncrease,
    priority: averageIncrease ?? Math.max(0, absoluteIncrease),
  }
}

type Build = Record<ArtifactSlotKey, ICachedArtifact | undefined>
type BuildVariant = {
  buildId: string
  buildName: string
  buildType: 'equipped' | 'saved' | 'tc'
  build: Build
  weapon?: ICachedWeapon
}
function getBuildVariants(
  database: ArtCharDatabase,
  datum: LoadoutDatum,
  characterKey: CharacterKey,
  confirmed: (buildId: string) => boolean
): BuildVariant[] {
  const variants: BuildVariant[] = []
  if (datum.buildType === 'equipped')
    variants.push({
      buildId: 'equipped',
      buildName: 'Equipped',
      buildType: 'equipped',
      build: database.teams.getLoadoutArtifacts(datum),
      weapon: database.teams.getLoadoutWeapon(datum),
    })
  if (datum.buildType === 'tc')
    variants.push({
      buildId: `tc:${datum.buildTcId}`,
      buildName: database.buildTcs.get(datum.buildTcId)?.name ?? 'Theorycraft',
      buildType: 'tc',
      build: database.teams.getLoadoutArtifacts(datum),
    })
  for (const [id, saved] of database.builds.entriesForCharacter(characterKey)) {
    // Global build lists include outfits saved for other team configurations.
    // Keep their original context, explicit team selections and confirmed links.
    if (
      saved.srcTeamCharId &&
      saved.srcTeamCharId !== datum.teamCharId &&
      !(datum.buildType === 'real' && datum.buildId === id) &&
      !(
        datum.compare &&
        datum.compareType === 'real' &&
        datum.compareBuildId === id
      ) &&
      !confirmed(`saved:${id}`)
    )
      continue
    variants.push({
      buildId: `saved:${id}`,
      buildName: saved.name,
      buildType: 'saved',
      build: objKeyMap(allArtifactSlotKeys, (slot) =>
        database.arts.get(saved.artifactIds[slot])
      ),
      // A saved build without a weapon is evaluated with the equipped one.
      weapon:
        database.weapons.get(saved.weaponId) ??
        database.weapons.get(database.chars.get(characterKey)?.equippedWeapon),
    })
  }
  return variants
}
function getSkipReason(
  type: BuildVariant['buildType'],
  build: Build,
  config: OptConfig | undefined
): CleanupSkipReason | undefined {
  if (type === 'tc') return 'theorycraftBuild'
  if (!allArtifactSlotKeys.every((slot) => build[slot]))
    return 'incompleteBuild'
  if (!config?.optimizationTarget?.length) return 'missingTarget'
  return undefined
}

type CleanupProblem = {
  top: CleanupTopProblem
  /** Value of the current build. */
  baseline: number
  /** Builds must exceed this value to show demand. Without a valid current
   * build (unmet minimum stats), every feasible top build counts. */
  threshold: number
  eligibleIds: Set<string>
}
function createCleanupProblem(
  database: ArtCharDatabase,
  teamId: string,
  teamCharId: string,
  characterKey: CharacterKey,
  build: Build,
  config: OptConfig,
  inventory: ICachedArtifact[],
  candidates: ICachedArtifact[],
  topN: number,
  weapon?: ICachedWeapon
): CleanupProblem | CleanupSkipReason {
  if (!weapon) return 'noWeapon'
  const activeCharKey = database.teams.getActiveTeamChar(teamId)?.key
  // Dynamic artifacts are supplied by the calculator for this particular variant.
  const teamData = getTeamData(database, teamId, teamCharId, 0, [], weapon)
  if (!activeCharKey || !teamData) return 'noTeamData'
  const workerData = uiDataForTeam(
    teamData.teamData,
    database.gender,
    activeCharKey
  )[characterKey]?.target.data[0]
  if (!workerData) return 'noTeamData'
  if (!config.optimizationTarget) return 'missingTarget'
  Object.assign(workerData, mergeData([workerData, dynamicData]))
  const target = objPathValue(
    workerData.display ?? {},
    config.optimizationTarget
  ) as NumNode | undefined
  if (!target) return 'invalidTarget'
  const constraints: { value: NumNode; minimum: number }[] = []
  for (const [path, settings] of Object.entries(config.statFilters))
    for (const setting of settings) {
      if (setting.disabled) continue
      const value = objPathValue(workerData.display ?? {}, JSON.parse(path)) as
        | NumNode
        | undefined
      if (!value) return 'invalidConstraint'
      const info = value.info && resolveInfo(value.info)
      constraints.push({
        value,
        minimum: info?.unit === '%' ? setting.value / 100 : setting.value,
      })
    }
  const nodes = optimize(
    [target, ...constraints.map(({ value }) => value)],
    workerData,
    ({ path: [path] }) => path !== 'dyn'
  ) as OptNode[]
  const pool = inventory.filter(
    (art) =>
      !cleanupCandidateExclusion(
        art,
        build,
        config,
        database,
        teamId,
        teamCharId
      )
  )
  const current = compactArtifacts(
    allArtifactSlotKeys.map((slot) => build[slot]!),
    0,
    false
  )
  const [baseline, ...values] = precompute(
    nodes,
    current.base,
    (node) => node.path[1],
    5
  )(
    allArtifactSlotKeys.map(
      (slot) => current.values[slot][0]
    ) as ArtifactBuildData[] & { length: 5 }
  )
  if (!Number.isFinite(baseline)) return 'nonFiniteValue'
  const feasible = values.every(
    (value, i) => value >= constraints[i].minimum - cleanupTolerance(value)
  )
  const ids = new Set(pool.map(({ id }) => id))
  return {
    top: {
      nodes,
      minimum: [
        Number.NEGATIVE_INFINITY,
        ...constraints.map(({ minimum }) => minimum),
      ],
      arts: compactArtifacts(pool, 0, false),
      exclusion: config.artSetExclusion,
      topN,
    },
    baseline,
    threshold: feasible
      ? baseline + cleanupTolerance(baseline)
      : Number.NEGATIVE_INFINITY,
    eligibleIds: new Set(
      candidates.filter(({ id }) => ids.has(id)).map(({ id }) => id)
    ),
  }
}

function createUpgrader({ top }: CleanupProblem, reference: Build) {
  if (!allArtifactSlotKeys.every((slot) => reference[slot])) return undefined
  try {
    return new UpOptCalculatorV2(
      top.nodes,
      [...top.minimum],
      reference,
      [],
      { enabled: false, minTotal: 4 },
      {
        enabled: false,
        setSlotMainStatKeys: objKeyMap(allArtifactSlotKeys, () => ({
          setKeys: [],
          mainStats: [],
        })),
        substats: [],
      }
    )
  } catch {
    return undefined
  }
}
/** Chance that leveling this piece beats the best build, as in the Upgrade Optimizer. */
function evaluateUpgrade(
  upgrader: UpOptCalculatorV2,
  art: ICachedArtifact,
  reference: Build,
  { top }: CleanupProblem,
  { upgradeThresholds }: ArtifactCleanupConfig
) {
  const swapped = allArtifactSlotKeys.map((slot) =>
    slot === art.slotKey ? art : reference[slot]!
  )
  if (
    !cleanupAllowedSets(
      swapped.map(({ setKey }) => ({ set: setKey })),
      top.exclusion
    )
  )
    return undefined
  const evaluation = upgrader.evaluateArtifact(art)
  if (evaluation.status !== 'evaluated' || evaluation.probability <= 0)
    return undefined
  const relative =
    evaluation.currentValue === 0
      ? Number.POSITIVE_INFINITY
      : (evaluation.averageIncrease * 100) / Math.abs(evaluation.currentValue)
  if (
    evaluation.probability * 100 < upgradeThresholds.minProbability ||
    relative < upgradeThresholds.minAverageIncrease
  )
    return undefined
  return evaluation
}

export function cleanupCandidateExclusion(
  art: ICachedArtifact,
  _build: Build,
  config: OptConfig,
  database?: ArtCharDatabase,
  teamId?: string,
  teamCharId?: string
): CleanupGOEvidence['status'] | undefined {
  if (!config.useExcludedArts && config.artExclusion.includes(art.id))
    return 'artifactExcluded'
  if (config.forcedArtifactSet && art.setKey !== config.forcedArtifactSet)
    return 'setExcluded'
  if (
    art.slotKey !== 'flower' &&
    art.slotKey !== 'plume' &&
    config.mainStatKeys[art.slotKey].length &&
    !config.mainStatKeys[art.slotKey].includes(art.mainStatKey)
  )
    return 'mainStatExcluded'
  if (database && teamId && teamCharId) {
    const key = database.teamChars.get(teamCharId)?.key
    if (
      art.location &&
      key &&
      art.location !== charKeyToLocCharKey(key) &&
      config.excludedLocations.includes(art.location)
    )
      return 'locationExcluded'
    if (
      !config.useTeammateBuild &&
      database.teams
        .get(teamId)
        ?.loadoutData.some(
          (datum) =>
            datum &&
            datum.teamCharId !== teamCharId &&
            Object.values(database.teams.getLoadoutArtifacts(datum)).some(
              (other) => other?.id === art.id
            )
        )
    )
      return 'locationExcluded'
  }
  return undefined
}

export function cleanupActionIds(
  database: ArtCharDatabase,
  result: ArtifactCleanupResult,
  selectedIds: readonly string[],
  lock: boolean
) {
  if (artifactCleanupSnapshot(database) !== result.snapshot) return []
  const selected = new Set(selectedIds)
  const referenced = cleanupReferencedArtifacts(database)
  return result.artifacts
    .filter((row) => {
      const art = database.arts.get(row.id)
      return (
        selected.has(row.id) &&
        art &&
        result.selectedSetKeys.includes(art.setKey) &&
        database.artifactCleanup.get().selectedSetKeys.includes(art.setKey) &&
        art.rarity === 5 &&
        !art.location &&
        !referenced.has(art.id) &&
        art.lock !== lock &&
        (lock
          ? row.recommendation === 'keep' || row.recommendation === 'level'
          : row.recommendation === 'discard')
      )
    })
    .map(({ id }) => id)
}
export function applyCleanupSelection(
  database: ArtCharDatabase,
  result: ArtifactCleanupResult,
  selectedIds: readonly string[],
  lock: boolean
) {
  if (artifactCleanupSnapshot(database) !== result.snapshot)
    return { stale: true, appliedIds: [] as string[] }
  const ids = cleanupActionIds(database, result, selectedIds, lock)
  ids.forEach((id) => database.arts.set(id, { lock }))
  return { stale: false, appliedIds: ids }
}
