import { initialArtifactCleanupConfig } from '@genshin-optimizer/gi/db'
import completeExport from './__fixtures__/ggartifact-v5.json'
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
  test('imports all 564 profiles and 127 characters from the supplied complete export', () => {
    const first = previewGGArtifactImport(
      completeExport,
      initialArtifactCleanupConfig()
    )
    expect(first).toMatchObject({ new: 564, invalid: 0, warnings: [] })
    expect(
      new Set(first.config!.profiles.map(({ base }) => base.characterKey)).size
    ).toBe(127)
    expect(
      first.config!.profiles.filter(({ base }) => !base.active)
    ).toHaveLength(8)
    expect(first.config!.importWarnings).toEqual([])
    const repeat = previewGGArtifactImport(completeExport, first.config!)
    expect(repeat).toMatchObject({
      new: 0,
      updated: 0,
      unchanged: 564,
      stale: 0,
    })
  })
  test('unknown import data remains visible and cannot silently remove coverage', () => {
    const result = previewGGArtifactImport(
      { version: 5, builds: { unknown: { characterId: 'unknown-character' } } },
      initialArtifactCleanupConfig()
    )
    expect(result.invalid).toBe(1)
    expect(result.config!.importWarnings.length).toBeGreaterThan(0)
  })
  test('re-import keeps confirmed coverage only while the profile remains unchanged', () => {
    const first = previewGGArtifactImport(
      version5,
      initialArtifactCleanupConfig()
    ).config!
    first.goProfileCoverage = { 'raiden-main': ['team:character:equipped'] }
    first.profileGroups = { 'raiden-main': 'custom-playstyle' }
    expect(
      previewGGArtifactImport(version5, first).config!.goProfileCoverage
    ).toEqual(first.goProfileCoverage)
    const changed = structuredClone(version5)
    changed.builds['raiden-main'].substats.cr = 50
    const update = previewGGArtifactImport(changed, first)
    expect(update.config!.goProfileCoverage).toEqual({})
    expect(update.config!.profileGroups).toEqual(first.profileGroups)
  })
  test('expands the imported elemental goblet and four-piece crit circlet options', () => {
    const input = structuredClone(version5) as typeof version5 & {
      computeOptions: Record<string, unknown>
    }
    input.computeOptions['expandElementalGoblet'] = true
    input.computeOptions['expandCritCirclet'] = true
    const result = previewGGArtifactImport(
      input,
      initialArtifactCleanupConfig()
    )
    expect(
      result.config!.profiles[0].base.mainStatWeights.goblet
    ).toMatchObject({ pyro_dmg_: 100, hydro_dmg_: 100, electro_dmg_: 100 })
    expect(
      result.config!.profiles[0].base.mainStatWeights.circlet
    ).toMatchObject({ critRate_: 100, critDMG_: 100 })
  })
  test('imports Vodyanitsa and Vesna profiles before GO has their combat data', () => {
    const result = previewGGArtifactImport(
      {
        version: 5,
        characterBuilds: { vodyanitsa: ['Kau_BLm'], vesna: ['KRbFcYu'] },
        builds: {
          Kau_BLm: {
            characterId: 'vodyanitsa',
            artifactSet: 'tenacity_of_the_millelith',
            substats: { 'hp%': 100, hp: 100 },
            sandsWeights: { 'hp%': 100 },
            gobletWeights: { 'hp%': 100 },
            circletWeights: { 'hp%': 100 },
          },
          KRbFcYu: {
            artifactSet: 'scarlet_proof',
            substats: { cr: 100, cd: 100, 'atk%': 100, em: 50, er: 50 },
            sandsWeights: { 'atk%': 100, em: 100 },
            gobletWeights: { 'atk%': 100, em: 100 },
            circletWeights: { cr: 100 },
          },
        },
      },
      initialArtifactCleanupConfig()
    )
    expect(result).toMatchObject({ new: 2, invalid: 0, warnings: [] })
    expect(result.config?.profiles.map(({ base }) => base)).toMatchObject([
      {
        id: 'Kau_BLm',
        characterKey: 'Vodyanitsa',
        setTargets: { fourPieceSets: ['TenacityOfTheMillelith'] },
        substatWeights: { hp_: 100, hp: 100 },
      },
      {
        id: 'KRbFcYu',
        characterKey: 'Vesna',
        setTargets: { fourPieceSets: ['ScarletProof'] },
        mainStatWeights: { circlet: { critRate_: 100 } },
      },
    ])
  })

  test('still rejects unknown character identifiers', () => {
    const result = previewGGArtifactImport(
      { version: 5, builds: { typo: { characterId: 'vesnaa' } } },
      initialArtifactCleanupConfig()
    )
    expect(result).toMatchObject({ new: 0, invalid: 1 })
    expect(result.config?.profiles).toEqual([])
  })

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
      halfSets: [
        'HeartOfDepth',
        'NymphsDream',
        'HuskOfOpulentDreams',
        'DefendersWill',
      ],
      halfSetOptions: [
        ['HeartOfDepth', 'NymphsDream'],
        ['HuskOfOpulentDreams', 'DefendersWill'],
      ],
    })
  })

  test('rejects unsupported versions without changing the config', () => {
    const current = initialArtifactCleanupConfig()
    const result = previewGGArtifactImport({ version: 4 }, current)
    expect(result).toMatchObject({ version: 4 })
    expect(result.config).toBeUndefined()
  })
})
