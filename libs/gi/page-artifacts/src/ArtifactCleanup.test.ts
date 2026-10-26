import { SandboxStorage } from '@genshin-optimizer/common/database'
import { objKeyMap } from '@genshin-optimizer/common/util'
import {
  type ArtifactSlotKey,
  allArtifactSlotKeys,
  type CharacterKey,
} from '@genshin-optimizer/gi/consts'
import {
  ArtCharDatabase,
  type CleanupBuildProfile,
  type ICachedArtifact,
  initialArtifactCleanupConfig,
  type LoadoutDatum,
} from '@genshin-optimizer/gi/db'
import type { IArtifact } from '@genshin-optimizer/gi/good'
import { getTeamData } from '@genshin-optimizer/gi/ui'
import { dynRead, prod, sum } from '@genshin-optimizer/gi/wr'
import { vi } from 'vitest'
import { cleanupProfileGroups } from './ArtifactCleanupGroups'
import {
  analyzeCleanupProfiles,
  cleanupProfileScore,
  expectedCleanupSubstats,
} from './ArtifactCleanupProfiles'
import * as cleanupWorkers from './ArtifactCleanupWorkerClient.mjs'
import {
  analyzeArtifactCleanup,
  applyCleanupSelection,
  cleanupCandidateExclusion,
  cleanupLoadoutOptions,
  cleanupLoadoutSelectionOptions,
} from './ArtifactSetCleanup'

vi.mock('@genshin-optimizer/gi/ui', () => ({
  getTeamData: vi.fn(() => ({ teamData: {} })),
  resolveInfo: vi.fn(() => ({ unit: '%' })),
}))
vi.mock('@genshin-optimizer/gi/uidata', () => ({
  uiDataForTeam: () => ({
    RaidenShogun: {
      target: {
        data: [
          {
            display: {
              test: sum(1, prod(100, dynRead('critRate_'))),
              energy: dynRead('enerRech_'),
            },
          },
        ],
      },
    },
  }),
}))

function profile(
  characterKey: CharacterKey = 'RaidenShogun',
  id: string = characterKey
): CleanupBuildProfile {
  return {
    id,
    characterKey,
    name: id,
    active: true,
    roles: ['dps'],
    styles: [],
    setTargets: {
      fourPieceSets: ['GladiatorsFinale'],
      halfSets: [],
      halfSetFamilies: [],
    },
    mainStatWeights: {
      sands: { atk_: 100 },
      goblet: { atk_: 100 },
      circlet: { critDMG_: 100 },
    },
    substatWeights: { critRate_: 100, critDMG_: 100 },
    substatWeightThreshold: 60,
    mustPresentWeightThreshold: 90,
  }
}
function addArtifact(db: ArtCharDatabase, values: Partial<IArtifact> = {}) {
  const id = db.arts.new({
    setKey: 'GladiatorsFinale',
    slotKey: 'flower',
    mainStatKey: 'hp',
    rarity: 5,
    level: 0,
    lock: true,
    location: '',
    substats: [
      { key: 'critRate_', value: 3.9 },
      { key: 'critDMG_', value: 7.8 },
      { key: 'atk_', value: 5.8 },
      { key: 'def', value: 23 },
    ],
    ...values,
  })
  expect(db.arts.get(id)).toBeDefined()
  return id
}
const weakStats: IArtifact['substats'] = [
  { key: 'atk_', value: 5.8 },
  { key: 'eleMas', value: 23 },
  { key: 'enerRech_', value: 6.5 },
  { key: 'def', value: 23 },
]
const maxStats: IArtifact['substats'] = [
  { key: 'critRate_', value: 23.3 },
  { key: 'critDMG_', value: 7.8 },
  { key: 'atk_', value: 5.8 },
  { key: 'def', value: 23 },
]
function makeDatabase() {
  const db = new ArtCharDatabase(1, new SandboxStorage())
  db.chars.getWithInitWeapon('RaidenShogun')
  db.artifactCleanup.set({
    selectedSetKeys: ['GladiatorsFinale', 'NoblesseOblige'],
    profiles: [{ base: profile() }],
  })
  return db
}
function addGOContext(db: ArtCharDatabase) {
  const optConfigId = db.optConfigs.new({
    optimizationTarget: ['test'],
    upOptLevelLow: 10,
    upOptLevelHigh: 15,
  })
  const teamCharId = db.teamChars.new('RaidenShogun', { optConfigId })
  const artifacts = Object.fromEntries(
    allArtifactSlotKeys.map((slot) => [
      slot,
      addArtifact(db, {
        slotKey: slot,
        mainStatKey: (
          {
            flower: 'hp',
            plume: 'atk',
            sands: 'atk_',
            goblet: 'atk_',
            circlet: 'critDMG_',
          } as const
        )[slot],
        level: 20,
        substats:
          slot === 'sands' || slot === 'goblet'
            ? [{ key: 'hp', value: 299 }, ...weakStats.slice(1)]
            : weakStats,
        location: 'RaidenShogun',
      }),
    ])
  )
  db.teams.new({
    name: 'Test team',
    loadoutData: [{ teamCharId, buildType: 'equipped' } as LoadoutDatum],
  })
  return { optConfigId, teamCharId, artifacts }
}

beforeEach(() =>
  vi.mocked(getTeamData).mockReturnValue({ teamData: {}, teamBundle: {} })
)

describe('unified artifact cleanup', () => {
  test('uses saved builds in their originating team context, preserving explicit assignments and selections', () => {
    const db = makeDatabase()
    const first = addGOContext(db)
    const second = addGOContext(db)
    const saved = db.builds.new({
      characterKey: 'RaidenShogun',
      srcTeamCharId: first.teamCharId,
      artifactIds: first.artifacts,
    })
    const savedOptions = () =>
      cleanupLoadoutOptions(db).filter(({ id }) =>
        id.endsWith(`saved:${saved}`)
      )
    expect(savedOptions()).toHaveLength(1)
    const secondTeam = db.teams.entries.find(([, team]) =>
      team.loadoutData.some((datum) => datum?.teamCharId === second.teamCharId)
    )!
    const id = `${secondTeam[0]}:${second.teamCharId}:saved:${saved}`
    db.artifactCleanup.set({ goProfileCoverage: { RaidenShogun: [id] } })
    expect(savedOptions().map(({ id }) => id)).toContain(id)
    db.artifactCleanup.set({ goProfileCoverage: {} })
    const datum = secondTeam[1].loadoutData[0]!
    db.teams.set(secondTeam[0], {
      loadoutData: [{ ...datum, buildType: 'real', buildId: saved }],
    })
    expect(savedOptions().map(({ id }) => id)).toContain(id)
    // Unattributed legacy builds keep their previous coverage.
    db.builds.set(saved, { srcTeamCharId: undefined })
    expect(savedOptions()).toHaveLength(2)
  })
  test('requires set selection and only returns or changes artifacts from selected sets', async () => {
    const db = makeDatabase()
    const selected = addArtifact(db, { substats: weakStats })
    const outside = addArtifact(db, {
      setKey: 'NoblesseOblige',
      substats: weakStats,
    })
    db.artifactCleanup.set({ selectedSetKeys: [] })
    await expect(analyzeArtifactCleanup(db)).rejects.toThrow(
      'Select artifact sets'
    )
    db.artifactCleanup.set({ selectedSetKeys: ['GladiatorsFinale'] })
    const result = await analyzeArtifactCleanup(db)
    expect(result.artifacts.map(({ id }) => id)).toEqual([selected])
    expect(
      applyCleanupSelection(db, result, [selected, outside], false).appliedIds
    ).toEqual([selected])
    expect(db.arts.get(outside)?.lock).toBe(true)
  })
  test('profile coverage requires a confirmed same-character GO assignment', async () => {
    const db = makeDatabase()
    addGOContext(db)
    addArtifact(db)
    const first = await analyzeArtifactCleanup(db)
    expect(first.profileCoverage[0].covered).toBe(false)
    const id = first.analyzedLoadouts[0].id
    db.artifactCleanup.set({ goProfileCoverage: { RaidenShogun: [id] } })
    const confirmed = await analyzeArtifactCleanup(db)
    expect(confirmed.profileCoverage[0].covered).toBe(true)
    expect(
      confirmed.artifacts.every(({ reservedFor }) => reservedFor.length === 0)
    ).toBe(true)
    // Failed GO restores the profile, instead of silently treating it as covered.
    vi.mocked(getTeamData).mockReturnValue(undefined)
    const fallback = await analyzeArtifactCleanup(db)
    expect(fallback.profileCoverage[0].covered).toBe(false)
    expect(
      fallback.artifacts.some(({ reservedFor }) =>
        reservedFor.some(({ profileId }) => profileId === 'RaidenShogun')
      )
    ).toBe(true)
  })
  test('covering one playstyle leaves another profile active', async () => {
    const db = makeDatabase()
    addGOContext(db)
    addArtifact(db)
    const first = await analyzeArtifactCleanup(db)
    db.artifactCleanup.set({
      profiles: [
        { base: profile() },
        { base: { ...profile('RaidenShogun', 'support'), roles: ['support'] } },
      ],
      goProfileCoverage: { RaidenShogun: [first.analyzedLoadouts[0].id] },
    })
    const result = await analyzeArtifactCleanup(db)
    expect(result.profileCoverage.map(({ covered }) => covered)).toEqual([
      true,
      false,
    ])
    expect(
      result.artifacts
        .flatMap(({ reservedFor }) => reservedFor)
        .some(({ profileId }) => profileId === 'support')
    ).toBe(true)
  })
  test('unfinished searches retain JSON coverage and cannot authorize unlocking', async () => {
    const db = makeDatabase()
    addGOContext(db)
    // Level 20: no Upgrade Optimizer chance can settle it instead.
    const candidate = addArtifact(db, { level: 20 })
    const id = cleanupLoadoutOptions(db)[0].id
    db.artifactCleanup.set({ goProfileCoverage: { RaidenShogun: [id] } })
    const search = vi
      .spyOn(cleanupWorkers, 'runCleanupTopBuilds')
      .mockImplementation(async () => ({
        builds: [],
        complete: false,
        remainingIds: new Set([candidate]),
      }))
    try {
      const result = await analyzeArtifactCleanup(db)
      const row = result.artifacts.find(({ id }) => id === candidate)!
      expect(row.goEvidence[0]).toMatchObject({
        status: 'searchLimit',
        upgrade: false,
      })
      expect(result.profileCoverage[0].covered).toBe(false)
      expect(result.skippedLoadouts[0].reason).toBe('searchLimit')
      expect(
        row.reservedFor.some(({ profileId }) => profileId === 'RaidenShogun')
      ).toBe(true)
      expect(row.recommendation).not.toBe('discard')
      expect(
        applyCleanupSelection(db, result, [candidate], false).appliedIds
      ).toEqual([])
      expect(db.arts.get(candidate)!.lock).toBe(true)
    } finally {
      search.mockRestore()
    }
  })
  test('GO upgrade overrides a negative profile match, including off-pieces and unlocked pieces', async () => {
    const db = makeDatabase()
    addGOContext(db)
    const id = addArtifact(db, { setKey: 'NoblesseOblige', lock: false })
    const result = await analyzeArtifactCleanup(db)
    const row = result.artifacts.find((row) => row.id === id)!
    expect(row.profileMatches).toEqual([])
    expect(row.recommendation).toBe('level')
    expect(row.goEvidence[0]).toMatchObject({
      status: 'topBuild',
      upgrade: true,
      rank: 1,
      accuracy: 'exact',
    })
    expect(row.priority).toBeGreaterThan(0)
  })
  test('evaluates level 20 deterministically regardless of Upgrader level settings', async () => {
    const db = makeDatabase()
    addGOContext(db)
    const id = addArtifact(db, {
      setKey: 'NoblesseOblige',
      level: 20,
      substats: maxStats,
    })
    const row = (await analyzeArtifactCleanup(db)).artifacts.find(
      (row) => row.id === id
    )!
    expect(row.recommendation).toBe('keep')
    expect(row.goEvidence[0]).toMatchObject({
      baseline: 1,
      bestValue: expect.any(Number),
      accuracy: 'exact',
      upgrade: true,
    })
  })
  test('reports unsuccessful evaluations instead of dropping them', async () => {
    const db = makeDatabase()
    addGOContext(db)
    const id = addArtifact(db, {
      setKey: 'NoblesseOblige',
      substats: weakStats,
    })
    const row = (await analyzeArtifactCleanup(db)).artifacts.find(
      (row) => row.id === id
    )!
    // It only appears in optimizer builds that do not beat the current one.
    expect(row.goEvidence[0]).toMatchObject({
      status: 'belowCurrent',
      baseline: 1,
      bestValue: 1,
      upgrade: false,
    })
    expect(row.recommendation).toBe('discard')
  })
  test('stat requirements and explicit artifact exclusions remain visible', async () => {
    const db = makeDatabase()
    const { optConfigId } = addGOContext(db)
    const id = addArtifact(db, {
      setKey: 'NoblesseOblige',
      level: 20,
      substats: maxStats,
    })
    db.optConfigs.set(optConfigId, {
      statFilters: { '["energy"]': [{ value: 500, disabled: false }] },
    })
    const unreachable = await analyzeArtifactCleanup(db)
    expect(unreachable.skippedLoadouts[0].reason).toBe('noFeasibleBuild')
    db.optConfigs.set(optConfigId, {
      statFilters: { '["energy"]': [{ value: 0.1, disabled: false }] },
    })
    // The current build misses the minimum; feasible top builds still count.
    let row = (await analyzeArtifactCleanup(db)).artifacts.find(
      (row) => row.id === id
    )!
    expect(row.goEvidence[0]).toMatchObject({ status: 'topBuild' })
    db.optConfigs.set(optConfigId, { statFilters: {} })
    db.optConfigs.set(optConfigId, { artExclusion: [id] })
    row = (await analyzeArtifactCleanup(db)).artifacts.find(
      (row) => row.id === id
    )!
    expect(row.recommendation).not.toBe('discard')
    expect(row.goEvidence[0].status).toBe('artifactExcluded')
  })
  test('accepts empty main-stat filters', () => {
    const db = makeDatabase()
    const id = addArtifact(db, {
      slotKey: 'sands',
      mainStatKey: 'atk_',
      substats: [],
    })
    const optId = db.optConfigs.new({})
    const config = {
      ...db.optConfigs.get(optId)!,
      mainStatKeys: { sands: [], goblet: [], circlet: [] },
    }
    const build = Object.fromEntries(
      allArtifactSlotKeys.map((key) => [key, undefined])
    ) as Record<ArtifactSlotKey, ICachedArtifact | undefined>
    expect(
      cleanupCandidateExclusion(db.arts.get(id)!, build, config)
    ).toBeUndefined()
  })
  test('protects equipped and saved-build pieces even at level 20', async () => {
    const db = makeDatabase()
    const equipped = addArtifact(db, { location: 'RaidenShogun' })
    const saved = addArtifact(db, { level: 20, substats: maxStats })
    db.builds.new({
      characterKey: 'RaidenShogun',
      artifactIds: objKeyMap(allArtifactSlotKeys, (slot) =>
        slot === 'flower' ? saved : undefined
      ),
    })
    const result = await analyzeArtifactCleanup(db)
    expect(
      result.artifacts
        .filter(({ recommendation }) => recommendation === 'protected')
        .map(({ id }) => id)
    ).toEqual(expect.arrayContaining([equipped, saved]))
    expect(
      applyCleanupSelection(db, result, [equipped, saved], false).appliedIds
    ).toEqual([])
  })
  test('missing character coverage and invalid GO data require review', async () => {
    const db = makeDatabase()
    const id = addArtifact(db, {
      setKey: 'NoblesseOblige',
      substats: weakStats,
    })
    db.artifactCleanup.set({ wishlist: ['Yelan'] })
    let result = await analyzeArtifactCleanup(db)
    expect(result.coverageMissing).toEqual(['Yelan'])
    expect(result.artifacts.find((row) => row.id === id)?.recommendation).toBe(
      'review'
    )
    db.artifactCleanup.set({ wishlist: [] })
    addGOContext(db)
    vi.mocked(getTeamData).mockReturnValue(undefined)
    result = await analyzeArtifactCleanup(db)
    // A failed GO build leaves the character to its JSON profile.
    expect(result.skippedLoadouts[0].reason).toBe('noTeamData')
    expect(result.analyzedLoadouts).toEqual([])
    expect(result.profileCoverage[0].covered).toBe(false)
    db.artifactCleanup.set({ profiles: [] })
    result = await analyzeArtifactCleanup(db)
    expect(result.coverageMissing).toEqual(['RaidenShogun'])
    expect(result.artifacts.find((row) => row.id === id)?.recommendation).toBe(
      'review'
    )
  })
  test('identical builds in identical teams are analyzed once', async () => {
    const db = makeDatabase()
    addGOContext(db)
    addGOContext(db)
    const options = cleanupLoadoutSelectionOptions(db, ['GladiatorsFinale'])
    expect(options).toHaveLength(1)
    expect(options[0].duplicates).toHaveLength(1)
    addArtifact(db)
    const result = await analyzeArtifactCleanup(db)
    expect(result.analyzedLoadouts).toHaveLength(1)
    // Confirmed coverage through the merged duplicate still counts.
    db.artifactCleanup.set({
      goProfileCoverage: { RaidenShogun: [options[0].duplicates![0].id] },
    })
    expect((await analyzeArtifactCleanup(db)).profileCoverage[0].covered).toBe(
      true
    )
  })
  test('only selected builds are optimized; deselected characters are no coverage gap', async () => {
    const db = makeDatabase()
    addGOContext(db)
    const id = addArtifact(db, {
      setKey: 'NoblesseOblige',
      substats: weakStats,
    })
    db.artifactCleanup.set({ selectedLoadoutIds: [], profiles: [] })
    const search = vi.spyOn(cleanupWorkers, 'runCleanupTopBuilds')
    try {
      const result = await analyzeArtifactCleanup(db)
      expect(search).not.toHaveBeenCalled()
      expect(result.analyzedLoadouts).toEqual([])
      expect(result.coverageMissing).toEqual([])
      expect(
        result.artifacts.find((row) => row.id === id)?.recommendation
      ).toBe('discard')
    } finally {
      search.mockRestore()
    }
  })
  test('suggests builds that wear or allow a chosen set', () => {
    const db = makeDatabase()
    const { optConfigId } = addGOContext(db)
    expect(
      cleanupLoadoutSelectionOptions(db, ['NoblesseOblige'])[0].suggested
    ).toBe(true)
    db.optConfigs.set(optConfigId, { forcedArtifactSet: 'GladiatorsFinale' })
    expect(
      cleanupLoadoutSelectionOptions(db, ['NoblesseOblige'])[0].suggested
    ).toBe(false)
    // The build wears the set itself.
    expect(
      cleanupLoadoutSelectionOptions(db, ['GladiatorsFinale'])[0].suggested
    ).toBe(true)
  })
  test('names the cause when a build cannot be calculated', async () => {
    const db = makeDatabase()
    const { optConfigId } = addGOContext(db)
    db.optConfigs.set(optConfigId, { optimizationTarget: ['removedTarget'] })
    addArtifact(db)
    const result = await analyzeArtifactCleanup(db)
    expect(result.skippedLoadouts[0].reason).toBe('invalidTarget')
  })
  test('unleveled pieces outside the top builds use the Upgrade Optimizer chance', async () => {
    const db = makeDatabase()
    addGOContext(db)
    const best = addArtifact(db, {
      level: 20,
      substats: maxStats,
      lock: false,
    })
    const unleveled = addArtifact(db, {
      level: 0,
      substats: [
        { key: 'critRate_', value: 3.9 },
        { key: 'atk', value: 19 },
        { key: 'def', value: 23 },
        { key: 'eleMas', value: 23 },
      ],
    })
    db.artifactCleanup.set({
      topN: 1,
      upgradeThresholds: { minProbability: 0, minAverageIncrease: 0 },
    })
    let result = await analyzeArtifactCleanup(db)
    const row = () => result.artifacts.find(({ id }) => id === unleveled)!
    expect(result.artifacts.find(({ id }) => id === best)?.recommendation).toBe(
      'keep'
    )
    expect(row().goEvidence[0]).toMatchObject({
      status: 'upgradeChance',
      accuracy: 'estimated',
      probability: expect.any(Number),
    })
    expect(row().goEvidence[0].probability).toBeGreaterThan(0)
    expect(row().recommendation).toBe('level')
    db.artifactCleanup.set({
      upgradeThresholds: { minProbability: 100, minAverageIncrease: 0 },
    })
    result = await analyzeArtifactCleanup(db)
    expect(row().goEvidence[0].status).toBe('notInTop')
  })
  test('cancellation and changes during a run never produce actionable results', async () => {
    const db = makeDatabase()
    addArtifact(db)
    await expect(
      analyzeArtifactCleanup(db, db.artifactCleanup.get(), {
        shouldCancel: () => true,
      })
    ).rejects.toThrow('cancelled')
    await expect(
      analyzeArtifactCleanup(db, db.artifactCleanup.get(), {
        onProgress: ({ phase }) => {
          if (phase === 'builds') db.artifactCleanup.set({ demandMargin: 2 })
        },
      })
    ).rejects.toThrow('inputs changed')
  })
  test('applies only the reviewed selection and rejects a stale snapshot', async () => {
    const db = makeDatabase()
    const a = addArtifact(db, {
      setKey: 'NoblesseOblige',
      substats: weakStats,
    })
    const b = addArtifact(db, {
      setKey: 'NoblesseOblige',
      substats: weakStats,
    })
    const result = await analyzeArtifactCleanup(db)
    expect(applyCleanupSelection(db, result, [a], false)).toEqual({
      stale: false,
      appliedIds: [a],
    })
    expect(db.arts.get(a)?.lock).toBe(false)
    expect(db.arts.get(b)?.lock).toBe(true)
    expect(applyCleanupSelection(db, result, [b], false)).toEqual({
      stale: true,
      appliedIds: [],
    })
  })
})

describe('profile demand and future-roll estimates', () => {
  test('groups set alternatives and supports explicit splitting and merging without merging characters', () => {
    const config = initialArtifactCleanupConfig()
    config.profiles = [
      { base: profile() },
      {
        base: {
          ...profile('RaidenShogun', 'alternate'),
          setTargets: {
            fourPieceSets: ['NoblesseOblige'],
            halfSets: [],
            halfSetFamilies: [],
          },
        },
      },
      { base: profile('Yelan') },
    ]
    expect(cleanupProfileGroups(config)).toHaveLength(2)
    config.profileGroups.alternate = 'separate'
    expect(cleanupProfileGroups(config)).toHaveLength(3)
    config.profileGroups = {
      RaidenShogun: 'merged',
      alternate: 'merged',
      Yelan: 'merged',
    }
    expect(cleanupProfileGroups(config)).toHaveLength(2)
  })
  test('all active imported characters create demand by default, including unowned characters', async () => {
    const db = makeDatabase()
    for (let i = 0; i < 3; i++) addArtifact(db)
    db.artifactCleanup.set({
      demandMargin: 0,
      profiles: [{ base: profile() }, { base: profile('Yelan') }],
    })
    const result = await analyzeArtifactCleanup(db)
    expect(result.counts.keep).toBe(2)
    expect(result.coverageMissing).toEqual([])
  })
  test('disabled profiles do not create demand or coverage gaps for owned characters outside GO teams', async () => {
    const db = makeDatabase()
    db.chars.getWithInitWeapon('Yelan')
    addArtifact(db)
    db.artifactCleanup.set({
      profiles: [
        { base: profile() },
        { base: { ...profile('Yelan'), active: false } },
      ],
    })
    expect((await analyzeArtifactCleanup(db)).coverageMissing).toEqual([])
  })
  test('a playstyle picks a coherent four-piece alternative, rather than mixing five sets', async () => {
    const db = makeDatabase()
    const ids = allArtifactSlotKeys.map((slot) =>
      addArtifact(db, {
        slotKey: slot,
        mainStatKey:
          slot === 'flower' ? 'hp' : slot === 'plume' ? 'atk' : 'atk_',
        substats: [
          { key: 'critRate_', value: 3.9 },
          { key: 'critDMG_', value: 7.8 },
          { key: 'enerRech_', value: 6.5 },
          { key: 'def', value: 23 },
        ],
      })
    )
    const off = addArtifact(db, {
      setKey: 'NoblesseOblige',
      level: 20,
      substats: maxStats,
    })
    db.artifactCleanup.set({
      demandMargin: 0,
      profiles: [
        {
          base: {
            ...profile(),
            mainStatWeights: {
              sands: { atk_: 100 },
              goblet: { atk_: 100 },
              circlet: { atk_: 100 },
            },
          },
        },
      ],
    })
    const result = await analyzeArtifactCleanup(db)
    const equipment = result.artifacts.filter(({ reservedFor }) =>
      reservedFor.some(({ reason }) => reason === 'equipment')
    )
    expect(equipment).toHaveLength(5)
    expect(
      equipment.filter(({ setKey }) => setKey === 'GladiatorsFinale')
    ).toHaveLength(4)
    expect(equipment.map(({ id }) => id)).toContain(off)
    expect(result.incompleteGroups).toEqual([])
    expect(ids).toHaveLength(5)
  })
  test('2+2 equipment preserves the two independent set-family choices', async () => {
    const db = makeDatabase()
    for (const setKey of ['GladiatorsFinale', 'NoblesseOblige'] as const)
      for (const slotKey of allArtifactSlotKeys)
        addArtifact(db, {
          setKey,
          slotKey,
          mainStatKey:
            slotKey === 'flower' ? 'hp' : slotKey === 'plume' ? 'atk' : 'atk_',
          substats: [
            { key: 'critRate_', value: 3.9 },
            { key: 'critDMG_', value: 7.8 },
            { key: 'enerRech_', value: 6.5 },
            { key: 'def', value: 23 },
          ],
        })
    db.artifactCleanup.set({
      demandMargin: 0,
      profiles: [
        {
          base: {
            ...profile(),
            mainStatWeights: {
              sands: { atk_: 100 },
              goblet: { atk_: 100 },
              circlet: { atk_: 100 },
            },
            setTargets: {
              fourPieceSets: [],
              halfSets: ['GladiatorsFinale', 'NoblesseOblige'],
              halfSetFamilies: [],
              halfSetOptions: [['GladiatorsFinale'], ['NoblesseOblige']],
            },
          },
        },
      ],
    })
    const result = await analyzeArtifactCleanup(db)
    const equipment = result.artifacts.filter(({ reservedFor }) =>
      reservedFor.some(({ reason }) => reason === 'equipment')
    )
    expect(equipment).toHaveLength(5)
    for (const set of ['GladiatorsFinale', 'NoblesseOblige'])
      expect(
        equipment.filter(({ setKey }) => setKey === set).length
      ).toBeGreaterThanOrEqual(2)
    expect(result.incompleteGroups).toEqual([])
  })
  test('does not consume a flexible piece when another character has no alternative', async () => {
    const db = makeDatabase()
    addArtifact(db, { level: 20, substats: maxStats })
    addArtifact(db, { setKey: 'NoblesseOblige' })
    db.artifactCleanup.set({
      demandMargin: 0,
      wishlist: ['Yelan'],
      profiles: [
        {
          base: {
            ...profile(),
            setTargets: {
              fourPieceSets: ['GladiatorsFinale', 'NoblesseOblige'],
              halfSets: [],
              halfSetFamilies: [],
            },
          },
        },
        { base: profile('Yelan') },
      ],
    })
    const result = await analyzeArtifactCleanup(db)
    expect(result.counts.keep).toBe(2)
    expect(
      result.artifacts
        .flatMap(({ reservedFor }) =>
          reservedFor.map(({ characterKey }) => characterKey)
        )
        .sort()
    ).toEqual(['RaidenShogun', 'Yelan'])
  })
  test('limits duplicates and shares alternative-profile demand', async () => {
    const db = makeDatabase()
    const ids = Array.from({ length: 6 }, () => addArtifact(db))
    db.artifactCleanup.set({
      profiles: [
        { base: profile() },
        { base: profile('RaidenShogun', 'alternate') },
      ],
    })
    const result = await analyzeArtifactCleanup(db)
    expect(result.counts.keep).toBe(2)
    expect(result.counts.discard).toBe(4)
    expect(
      result.artifacts
        .filter(({ recommendation }) => recommendation === 'keep')
        .map(({ id }) => id)
        .sort()
    ).toEqual(ids.slice().sort().slice(0, 2))
  })
  test('duplicate profile alternatives do not multiply compatible shared reserves', async () => {
    const db = makeDatabase()
    for (let i = 0; i < 5; i++) addArtifact(db)
    db.artifactCleanup.set({
      profiles: [
        { base: profile() },
        { base: profile('RaidenShogun', 'duplicate') },
        { base: profile('Yelan') },
      ],
    })
    const result = await analyzeArtifactCleanup(db)
    expect(result.counts.keep).toBe(3) // two character demands and one shared spare
    expect(
      result.artifacts
        .flatMap(({ reservedFor }) => reservedFor)
        .filter(({ reason }) => reason === 'reserve')
    ).toHaveLength(1)
  })
  test('owned scope preserves owned plus wishlist behavior', async () => {
    const db = makeDatabase()
    addArtifact(db)
    addArtifact(db)
    addArtifact(db)
    db.artifactCleanup.set({
      demandMargin: 0,
      profiles: [{ base: profile() }, { base: profile('Yelan') }],
      characterScope: 'owned',
    })
    let result = await analyzeArtifactCleanup(db)
    expect(result.counts.keep).toBe(1)
    db.artifactCleanup.set({ wishlist: ['Yelan'] })
    result = await analyzeArtifactCleanup(db)
    expect(result.counts.keep).toBe(2)
    db.artifactCleanup.set({
      characterCoverage: { RaidenShogun: 'notRelevant' },
    })
    expect((await analyzeArtifactCleanup(db)).counts.keep).toBe(1)
  })
  test('cleanup-only wishlist characters reserve artifacts and can be excluded', async () => {
    const db = makeDatabase()
    for (let i = 0; i < 4; i++) addArtifact(db)
    db.artifactCleanup.set({
      demandMargin: 0,
      wishlist: ['Vodyanitsa', 'Vesna'],
      profiles: [
        { base: profile() },
        {
          base: { ...profile(), id: 'vodyanitsa', characterKey: 'Vodyanitsa' },
        },
        { base: { ...profile(), id: 'vesna', characterKey: 'Vesna' } },
      ],
    })
    const result = await analyzeArtifactCleanup(db)
    expect(result.coverageMissing).toEqual([])
    expect(result.counts.keep).toBe(3)
    expect(
      result.artifacts
        .flatMap(({ reservedFor }) => reservedFor)
        .map(({ characterKey }) => characterKey)
        .sort()
    ).toEqual(['RaidenShogun', 'Vesna', 'Vodyanitsa'])
    db.artifactCleanup.set({ characterCoverage: { Vesna: 'notRelevant' } })
    expect((await analyzeArtifactCleanup(db)).counts.keep).toBe(2)
  })
  test('an equipped piece fills its owners demand; one physical piece cannot fill two characters', async () => {
    const db = makeDatabase()
    addArtifact(db, { location: 'RaidenShogun' })
    addArtifact(db)
    addArtifact(db)
    db.artifactCleanup.set({
      demandMargin: 0,
      wishlist: ['Yelan'],
      profiles: [{ base: profile() }, { base: profile('Yelan') }],
    })
    const result = await analyzeArtifactCleanup(db)
    expect(result.counts.protected).toBe(1)
    expect(result.counts.keep).toBe(1)
    expect(result.counts.discard).toBe(1)
  })
  test('weights actual values, excludes main stats, and models unknown and known fourth lines', () => {
    const db = makeDatabase()
    const low = db.arts.get(addArtifact(db))!
    const high = db.arts.get(
      addArtifact(db, { level: 20, substats: maxStats })
    )!
    expect(expectedCleanupSubstats(high).critRate_).toBeGreaterThan(
      expectedCleanupSubstats(low).critRate_!
    )
    expect(expectedCleanupSubstats(high).hp).toBeUndefined()
    const unknown = db.arts.get(
      addArtifact(db, { substats: weakStats.slice(0, 3) })
    )!
    expect(expectedCleanupSubstats(unknown).critRate_).toBeGreaterThan(0)
    const known = db.arts.get(
      addArtifact(db, {
        substats: weakStats.slice(0, 3),
        unactivatedSubstats: [{ key: 'critRate_', value: 3.9 }],
      })
    )!
    expect(expectedCleanupSubstats(known).critRate_).toBeGreaterThan(
      expectedCleanupSubstats(unknown).critRate_!
    )
    // A single unknown fourth line cannot supply two required stats.
    expect(
      cleanupProfileScore(unknown, profile(), expectedCleanupSubstats(unknown))
    ).toBeUndefined()
    const critOnly = { ...profile(), substatWeights: { critRate_: 100 } }
    expect(
      cleanupProfileScore(unknown, critOnly, expectedCleanupSubstats(unknown))
    ).toBeGreaterThan(0)
    const knownOther = db.arts.get(
      addArtifact(db, {
        substats: weakStats.slice(0, 3),
        unactivatedSubstats: [{ key: 'def', value: 23 }],
      })
    )!
    expect(
      cleanupProfileScore(
        knownOther,
        critOnly,
        expectedCleanupSubstats(knownOther)
      )
    ).toBeUndefined()
  })
  test('explicit keep patterns protect without active character demand', async () => {
    const db = makeDatabase()
    addArtifact(db)
    const id = addArtifact(db, { setKey: 'NoblesseOblige' })
    db.artifactCleanup.set({
      patterns: [
        {
          id: 'crit',
          name: 'Crit',
          enabled: true,
          requiredSubstats: ['critRate_'],
        },
      ],
    })
    expect(
      (await analyzeArtifactCleanup(db)).artifacts.find((row) => row.id === id)
    ).toMatchObject({ recommendation: 'keep', reasons: ['pattern'] })
  })
  test('preserves configured set-slot floors', async () => {
    const db = makeDatabase()
    addArtifact(db)
    const id = addArtifact(db, { setKey: 'NoblesseOblige' })
    db.artifactCleanup.set({
      floors: { ...initialArtifactCleanupConfig().floors, flower: 1 },
    })
    expect(
      (await analyzeArtifactCleanup(db)).artifacts.find((row) => row.id === id)
    ).toMatchObject({ recommendation: 'keep', reasons: ['floor'] })
  })
  test('keeps invalid profile and artifact data out of discard recommendations', async () => {
    const db = makeDatabase()
    const id = addArtifact(db, { setKey: 'NoblesseOblige' })
    db.artifactCleanup.set({
      profiles: [
        {
          base: {
            ...profile(),
            setTargets: {
              fourPieceSets: [],
              halfSets: [],
              halfSetFamilies: [],
            },
          },
        },
      ],
    })
    const result = await analyzeArtifactCleanup(db)
    expect(result.profileWarnings).toHaveLength(1)
    expect(result.artifacts.find((row) => row.id === id)?.recommendation).toBe(
      'review'
    )
    // A working GO context doesn't fill the gap left by an invalid active
    // alternate profile. Only affirmative keep evidence can override it.
    addGOContext(db)
    const noUpgrade = addArtifact(db, {
      setKey: 'NoblesseOblige',
      level: 20,
      substats: weakStats,
    })
    const covered = await analyzeArtifactCleanup(db)
    expect(covered.analyzedLoadouts).toHaveLength(1)
    expect(covered.artifacts.find((row) => row.id === noUpgrade)).toMatchObject(
      {
        recommendation: 'review',
        goEvidence: [
          expect.objectContaining({ status: 'belowCurrent', upgrade: false }),
        ],
      }
    )
    const invalid = {
      ...db.arts.get(id)!,
      substats: [{ key: 'critRate_', accurateValue: Number.NaN }],
    } as ICachedArtifact
    const reservations = await analyzeCleanupProfiles({
      artifacts: [invalid],
      config: db.artifactCleanup.get(),
      relevantCharacters: ['RaidenShogun'],
    })
    expect(reservations.invalidArtifactIds.has(id)).toBe(true)
  })
  test('handles a large inventory with bounded reserves and progress', async () => {
    const db = makeDatabase()
    for (let i = 0; i < 1800; i++) addArtifact(db)
    const progress: number[] = []
    const result = await analyzeArtifactCleanup(db, db.artifactCleanup.get(), {
      onProgress: ({ current }) => progress.push(current),
    })
    expect(result.artifacts).toHaveLength(1800)
    expect(result.counts.keep).toBe(2)
    expect(result.counts.discard).toBe(1798)
    expect(progress).toContain(1800)
  }, 20000)
})
