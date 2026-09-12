import { initialArtifactCleanupConfig } from '@genshin-optimizer/gi/db'
import { previewGGArtifactImport } from './GGArtifactImport'

const version5 = {
  version: 5,
  computeOptions: {
    substatWeightThreshold: 70,
    mustPresentWeightThreshold: 90,
  },
  characterBuilds: { raiden_shogun: ['raiden-main'] },
  builds: {
    'raiden-main': {
      characterId: 'raiden_shogun',
      visible: false,
      name: 'Burst',
      roles: ['dps', 'support'],
      styles: ['on-field'],
      composition: '4pc',
      artifactSet: 'emblem_of_severed_fate',
      sandsWeights: { 'atk%': 80, er: 100 },
      gobletWeights: { electro: 100, 'phys%': 90 },
      circletWeights: { cd: 100 },
      substats: { cr: 100, cd: 90, er: 80, hp: 10 },
      kOverride: 3,
    },
  },
}

describe('GGArtifact format 5 import', () => {
  test('maps a character, sets, stats, and compute options', () => {
    const result = previewGGArtifactImport(
      version5,
      initialArtifactCleanupConfig()
    )
    expect(result).toMatchObject({ new: 1, updated: 0, invalid: 0, stale: 0 })
    expect(result.config?.profiles[0]?.base).toMatchObject({
      id: 'raiden-main',
      characterKey: 'RaidenShogun',
      active: false,
      setTargets: { fourPieceSets: ['EmblemOfSeveredFate'] },
      mainStatWeights: {
        sands: { atk_: 80, enerRech_: 100 },
        goblet: { electro_dmg_: 100, physical_dmg_: 90 },
        circlet: { critDMG_: 100 },
      },
      substatWeights: { critRate_: 100, critDMG_: 90, enerRech_: 80, hp: 10 },
      kOverride: 3,
      substatWeightThreshold: 70,
      mustPresentWeightThreshold: 90,
    })
  })

  test('keeps overrides and marks removed imported builds stale', () => {
    const first = previewGGArtifactImport(
      version5,
      initialArtifactCleanupConfig()
    )
    const current = first.config!
    current.profiles[0]!.overrides = { name: 'My Raiden profile' }
    const repeat = previewGGArtifactImport(version5, current)
    expect(repeat).toMatchObject({ new: 0, unchanged: 1 })
    expect(repeat.config?.profiles[0]?.overrides).toEqual({
      name: 'My Raiden profile',
    })

    const removed = previewGGArtifactImport(
      { version: 5, characterBuilds: {}, builds: [] },
      repeat.config!
    )
    expect(removed).toMatchObject({ stale: 1 })
    expect(removed.config?.profiles[0]?.base.active).toBe(false)
  })

  test('accepts and expands published two-piece set family identifiers', () => {
    const result = previewGGArtifactImport(
      {
        version: 5,
        characterBuilds: { ayaka: ['two-piece'] },
        builds: {
          'two-piece': {
            characterId: 'ayaka',
            composition: '2pc+2pc',
            halfSet1: 'hydro%-15',
            halfSet2: 3,
            substats: [],
            sandsWeights: [],
            gobletWeights: [],
            circletWeights: [],
          },
        },
      },
      initialArtifactCleanupConfig()
    )
    expect(result.warnings).toEqual([])
    expect(result.config?.profiles[0]?.base.setTargets).toEqual({
      fourPieceSets: [],
      halfSetFamilies: ['hydro-dmg-15', 'def%-30'],
      halfSets: ['HeartOfDepth', 'HuskOfOpulentDreams'],
    })
  })

  test('rejects unsupported versions without changing the config', () => {
    const current = initialArtifactCleanupConfig()
    const result = previewGGArtifactImport({ version: 4 }, current)
    expect(result).toMatchObject({ version: 4 })
    expect(result.config).toBeUndefined()
  })
})
