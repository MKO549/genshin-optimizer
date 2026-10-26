import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import {
  buildGoodScannerManageTargets,
  toGoodScannerArtifact,
} from './GoodScannerManager'

function artifact(
  id: string,
  overrides: Partial<ICachedArtifact> = {}
): ICachedArtifact {
  return {
    id,
    setKey: 'EmblemOfSeveredFate',
    slotKey: 'sands',
    rarity: 5,
    level: 20,
    mainStatKey: 'enerRech_',
    location: '',
    lock: false,
    elixirCrafted: true,
    mainStatVal: 0,
    substats: [
      {
        key: 'critRate_',
        value: 10.5,
        initialValue: 3.1,
        rolls: [],
        efficiency: 1,
        accurateValue: 10.49,
      },
    ],
    unactivatedSubstats: [
      {
        key: 'def',
        value: 23,
        rolls: [],
        efficiency: 1,
        accurateValue: 23,
      },
    ],
    ...overrides,
  }
}

describe('GOODScanner manager payload', () => {
  test('uses GOOD fields and removes Optimizer-only substat properties', () => {
    expect(toGoodScannerArtifact(artifact('a'))).toEqual({
      setKey: 'EmblemOfSeveredFate',
      slotKey: 'sands',
      rarity: 5,
      level: 20,
      mainStatKey: 'enerRech_',
      substats: [{ key: 'critRate_', value: 10.5 }],
      unactivatedSubstats: [{ key: 'def', value: 23 }],
      location: '',
      lock: false,
      elixirCrafted: true,
    })
  })

  test('assigns result IDs in the order GOODScanner returns them', () => {
    const targets = buildGoodScannerManageTargets([
      artifact('unlock', { lock: false }),
      artifact('lock', { lock: true, setKey: 'GladiatorsFinale' }),
    ])
    expect(targets.request.lock).toHaveLength(1)
    expect(targets.request.unlock).toHaveLength(1)
    expect(
      targets.targets.map(({ id, resultId }) => ({ id, resultId }))
    ).toEqual([
      { id: 'lock', resultId: 'lock:0' },
      { id: 'unlock', resultId: 'unlock:0' },
    ])
  })

  test('excludes identical pieces when their desired states conflict', () => {
    const targets = buildGoodScannerManageTargets([
      artifact('lock', { lock: true }),
      artifact('unlock', { lock: false }),
    ])
    expect(targets.targets).toEqual([])
    expect(targets.errors.map(({ id }) => id)).toEqual(['lock', 'unlock'])
  })

  test('rejects artifacts outside GOODScanner rarity support', () => {
    const targets = buildGoodScannerManageTargets([
      artifact('three-star', { rarity: 3 }),
    ])
    expect(targets.targets).toEqual([])
    expect(targets.errors[0]?.message).toMatch(/4-star/)
  })
})
