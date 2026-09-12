import type { IArtifact } from '@genshin-optimizer/gi/good'
import { matchesStrongOffPieceRule } from './offPieceRule'

const artifact = (data: Partial<IArtifact>): IArtifact => ({
  setKey: 'GladiatorsFinale',
  slotKey: 'flower',
  level: 0,
  rarity: 5,
  mainStatKey: 'hp',
  location: '',
  lock: true,
  substats: [],
  ...data,
})
const substats = (...keys: IArtifact['substats'][number]['key'][]) =>
  keys.map((key) => ({ key, value: 1 }))

describe('matchesStrongOffPieceRule', () => {
  it('protects flexible four-line flower and plume pieces', () => {
    expect(
      matchesStrongOffPieceRule(
        artifact({
          totalRolls: 4,
          substats: substats('critRate_', 'critDMG_', 'atk_', 'def'),
        })
      )
    ).toBe(true)
  })

  it('does not protect a known three-line start', () => {
    expect(
      matchesStrongOffPieceRule(
        artifact({
          level: 4,
          totalRolls: 4,
          substats: substats('critRate_', 'critDMG_', 'atk_', 'def'),
        })
      )
    ).toBe(false)
  })

  it('protects double-crit sands and goblets', () => {
    expect(
      matchesStrongOffPieceRule(
        artifact({
          slotKey: 'goblet',
          mainStatKey: 'pyro_dmg_',
          totalRolls: 4,
          substats: substats('critRate_', 'critDMG_', 'atk_', 'def'),
        })
      )
    ).toBe(true)
  })

  it('requires the opposite crit and a useful stat on crit circlets', () => {
    const base = {
      slotKey: 'circlet' as const,
      mainStatKey: 'critRate_' as const,
      totalRolls: 4,
    }
    expect(
      matchesStrongOffPieceRule(
        artifact({
          ...base,
          substats: substats('critDMG_', 'enerRech_', 'atk', 'def'),
        })
      )
    ).toBe(true)
    expect(
      matchesStrongOffPieceRule(
        artifact({
          ...base,
          substats: substats('critDMG_', 'atk', 'def', 'hp'),
        })
      )
    ).toBe(false)
  })

  it('protects healing circlets with ER and a scaling stat', () => {
    expect(
      matchesStrongOffPieceRule(
        artifact({
          slotKey: 'circlet',
          mainStatKey: 'heal_',
          totalRolls: 4,
          substats: substats('enerRech_', 'hp_', 'critRate_', 'def'),
        })
      )
    ).toBe(true)
  })
})
