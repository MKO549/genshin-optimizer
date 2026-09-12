import type {
  ArtifactCleanupConfig,
  CleanupBuildProfile,
  ICachedArtifact,
} from '@genshin-optimizer/gi/db'
import { initialArtifactCleanupConfig } from '@genshin-optimizer/gi/db'
import { analyzeArtifactProfileTriage } from './ArtifactProfileTriage'

function profile(
  overrides: Partial<CleanupBuildProfile> = {}
): CleanupBuildProfile {
  return {
    id: 'raiden',
    characterKey: 'RaidenShogun',
    name: 'Raiden',
    active: true,
    roles: ['dps'],
    styles: [],
    setTargets: {
      fourPieceSets: ['ShimenawasReminiscence'],
      halfSetFamilies: [],
      halfSets: [],
    },
    mainStatWeights: { sands: { atk_: 100 } },
    substatWeights: { critRate_: 100, critDMG_: 100 },
    substatWeightThreshold: 60,
    mustPresentWeightThreshold: 90,
    ...overrides,
  }
}
function config(overrides: Partial<ArtifactCleanupConfig> = {}) {
  const initial = initialArtifactCleanupConfig()
  return {
    ...initial,
    floors: { flower: 0, plume: 0, sands: 0, goblet: 0, circlet: 0 },
    extraFloors: { flower: 0, plume: 0, sands: 0, goblet: 0, circlet: 0 },
    profiles: [{ base: profile() }],
    ...overrides,
  }
}
function artifact(
  id: string,
  substats: string[],
  overrides: Partial<ICachedArtifact> = {}
) {
  return {
    id,
    setKey: 'ShimenawasReminiscence',
    slotKey: 'sands',
    mainStatKey: 'atk_',
    rarity: 5,
    level: 0,
    lock: true,
    location: '',
    totalRolls: 4,
    substats: substats.map((key) => ({ key, efficiency: 1 })),
    ...overrides,
  } as unknown as ICachedArtifact
}

describe('artifact profile triage', () => {
  test('keeps four-start prime pieces and unlocks unmatched candidates', () => {
    const result = analyzeArtifactProfileTriage({
      artifacts: [
        artifact('prime', ['critRate_', 'critDMG_', 'enerRech_', 'atk']),
        artifact('safe', ['hp', 'def', 'eleMas', 'atk']),
      ],
      config: config({
        builtInPatterns: {
          doubleCritFourStart: false,
          erForSupportSustain: false,
          erEverywhere: false,
        },
      }),
      ownedCharacterKeys: ['RaidenShogun'],
    })
    expect(result.safeIds).toEqual(['safe'])
    expect(result.protected).toContainEqual(
      expect.objectContaining({ id: 'prime', reason: 'prime' })
    )
  })

  test('pattern and non-candidate safety rules are never unlocked', () => {
    const result = analyzeArtifactProfileTriage({
      artifacts: [
        artifact('pattern', ['critRate_', 'critDMG_', 'hp', 'def']),
        artifact('equipped', ['hp', 'def', 'eleMas', 'atk'], {
          location: 'RaidenShogun',
        }),
      ],
      config: config(),
      ownedCharacterKeys: ['RaidenShogun'],
    })
    expect(result.safeIds).toEqual([])
    expect(result.protected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'pattern', reason: 'pattern' }),
        expect.objectContaining({ id: 'equipped', reason: 'safety' }),
      ])
    )
  })

  test('missing character coverage blocks only the unlock recommendation', () => {
    const result = analyzeArtifactProfileTriage({
      artifacts: [artifact('candidate', ['hp', 'def', 'eleMas', 'atk'])],
      config: config(),
      ownedCharacterKeys: ['RaidenShogun', 'Yelan'],
    })
    expect(result.coverageMissing).toEqual(['Yelan'])
    expect(result.safeIds).toEqual([])
  })
})
