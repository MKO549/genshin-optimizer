import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '../ArtCharDatabase'

describe('ArtifactCleanupConfigEntry', () => {
  test('preserves cleanup configuration when reopening the same storage', () => {
    const storage = new SandboxStorage()
    const source = new ArtCharDatabase(1, storage)
    source.artifactCleanup.set({
      selectedSetKeys: ['NoblesseOblige'],
      profileGroups: { dps: 'playstyle' },
      goProfileCoverage: { dps: ['team:character:equipped'] },
      profiles: [
        {
          base: {
            id: 'persistent-profile',
            characterKey: 'RaidenShogun',
            name: 'DPS',
            active: true,
            roles: ['dps'],
            styles: [],
            setTargets: {
              fourPieceSets: ['NoblesseOblige'],
              halfSets: [],
              halfSetFamilies: [],
            },
            mainStatWeights: {
              sands: { atk_: 100 },
              goblet: { electro_dmg_: 100 },
              circlet: { critRate_: 100 },
            },
            substatWeights: { critRate_: 100 },
            substatWeightThreshold: 60,
            mustPresentWeightThreshold: 90,
          },
        },
      ],
    })
    const reopened = new ArtCharDatabase(1, storage)
    expect(reopened.artifactCleanup.get()).toMatchObject({
      selectedSetKeys: ['NoblesseOblige'],
      profileGroups: { dps: 'playstyle' },
      goProfileCoverage: { dps: ['team:character:equipped'] },
      profiles: [{ base: { id: 'persistent-profile' } }],
    })
    expect(reopened.arts.values).toEqual([])
  })
  test('migrates cleanup scope without reinterpreting old probability thresholds', () => {
    const db = new ArtCharDatabase(1, new SandboxStorage())
    const migrated = db.artifactCleanup.validate({
      version: 2,
      upgradeThresholds: { minProbability: 50, minAverageIncrease: 2 },
      demandMargin: 3,
    })!
    expect(migrated).toMatchObject({
      version: 3,
      selectedSetKeys: [],
      characterScope: 'allProfiles',
      profileGroups: {},
      goProfileCoverage: {},
      demandMargin: 3,
      upgradeThresholds: { minProbability: 50, minAverageIncrease: 2 },
    })
  })
  test('exports confirmed coverage, explicit groups and selected sets with the database', () => {
    const source = new ArtCharDatabase(1, new SandboxStorage())
    source.artifactCleanup.set({
      selectedSetKeys: ['GladiatorsFinale', 'NoblesseOblige'],
      profileGroups: { dps: 'manual-group' },
      goProfileCoverage: { dps: ['team:character:equipped'] },
      importWarnings: ['unknown source set'],
    })
    const target = new ArtCharDatabase(2, new SandboxStorage())
    target.importGOOD(source.exportGOOD(), true, true, false)
    expect(target.artifactCleanup.get()).toMatchObject({
      selectedSetKeys: ['GladiatorsFinale', 'NoblesseOblige'],
      profileGroups: { dps: 'manual-group' },
      goProfileCoverage: { dps: ['team:character:equipped'] },
      importWarnings: ['unknown source set'],
    })
  })
  test('rejects unknown sets and damaged group or coverage entries', () => {
    const db = new ArtCharDatabase(1, new SandboxStorage())
    const result = db.artifactCleanup.validate({
      selectedSetKeys: ['GladiatorsFinale', 'typo', 'GladiatorsFinale'],
      profileGroups: { valid: 'group', invalid: 3 },
      goProfileCoverage: { valid: ['one', 2, 'one'], invalid: 'not-an-array' },
    })!
    expect(result.selectedSetKeys).toEqual(['GladiatorsFinale'])
    expect(result.profileGroups).toEqual({ valid: 'group' })
    expect(result.goProfileCoverage).toEqual({ valid: ['one'] })
  })
  test('preserves cleanup-only characters in wishlist and database export/import', () => {
    const source = new ArtCharDatabase(1, new SandboxStorage())
    source.artifactCleanup.set({
      wishlist: ['Vodyanitsa', 'Vesna'],
      characterCoverage: { Vesna: 'notRelevant' },
    })
    const target = new ArtCharDatabase(2, new SandboxStorage())
    target.importGOOD(source.exportGOOD(), true, true, false)
    expect(target.artifactCleanup.get()).toMatchObject({
      wishlist: ['Vodyanitsa', 'Vesna'],
      characterCoverage: { Vesna: 'notRelevant' },
    })
  })

  test('uses defaults and participates in the normal database export/import', () => {
    const source = new ArtCharDatabase(1, new SandboxStorage())
    expect(source.artifactCleanup.get()).toMatchObject({
      version: 3,
      wishlist: [],
      demandMargin: 1,
      fillerCap: 1,
    })

    source.artifactCleanup.set({ demandMargin: 2 })
    const exported = source.exportGOOD()
    expect(exported['artifact_cleanup_config']).toMatchObject({
      version: 3,
      demandMargin: 2,
    })

    const target = new ArtCharDatabase(2, new SandboxStorage())
    target.importGOOD(exported, true, true, false)
    expect(target.artifactCleanup.get().demandMargin).toBe(2)
  })

  test('migrates V1 without losing floors, profile overrides or thresholds', () => {
    const source = new ArtCharDatabase(1, new SandboxStorage())
    const migrated = source.artifactCleanup.validate({
      version: 1,
      floors: { flower: 5, plume: 5, sands: 3, goblet: 3, circlet: 3 },
      extraFloors: { flower: 10, plume: 10, sands: 5, goblet: 3, circlet: 3 },
      profiles: [{ base: { id: 'old' }, overrides: { name: 'Local name' } }],
      upgradeThresholds: { minProbability: 5, minAverageIncrease: 1 },
      characterCoverage: { Yelan: 'notRelevant' },
    })!
    expect(migrated.version).toBe(3)
    expect(migrated.wishlist).toEqual([])
    expect(migrated.floors.flower).toBe(5)
    expect(migrated.extraFloors.flower).toBe(10)
    expect(migrated.profiles[0].overrides).toEqual({ name: 'Local name' })
    expect(migrated.upgradeThresholds).toEqual({
      minProbability: 5,
      minAverageIncrease: 1,
    })
    expect(migrated.characterCoverage.Yelan).toBe('notRelevant')
  })

  test('defaults to zero floors and sanitizes numeric settings and wishlist', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    expect(Object.values(database.artifactCleanup.get().floors)).toEqual([
      0, 0, 0, 0, 0,
    ])
    const value = database.artifactCleanup.validate({
      wishlist: ['Yelan', 'Yelan', 'invalid'],
      demandMargin: -1,
      floors: { flower: Number.NaN },
      upgradeThresholds: {
        minProbability: Number.POSITIVE_INFINITY,
        minAverageIncrease: -4,
      },
    })!
    expect(value.wishlist).toEqual(['Yelan'])
    expect(value.demandMargin).toBe(0)
    expect(value.floors.flower).toBe(0)
    expect(value.upgradeThresholds).toEqual({
      minProbability: 5,
      minAverageIncrease: 0,
    })
  })
  test('sanitizes build selection, top-N size and time limit', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    expect(database.artifactCleanup.get()).toMatchObject({
      topN: 20,
      maxLoadoutSeconds: 30,
    })
    expect(database.artifactCleanup.get().selectedLoadoutIds).toBeUndefined()
    const value = database.artifactCleanup.validate({
      selectedLoadoutIds: ['a', 'a', 3, 'b'],
      topN: 0,
      maxLoadoutSeconds: Number.NaN,
    })!
    expect(value.selectedLoadoutIds).toEqual(['a', 'b'])
    expect(value.topN).toBe(1)
    expect(value.maxLoadoutSeconds).toBe(30)
    expect(database.artifactCleanup.validate({ topN: 1000.5 })!.topN).toBe(200)
  })
})
