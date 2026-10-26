import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import type {
  ArtifactBuildData,
  ArtifactsBySlot,
} from '@genshin-optimizer/gi/solver'
import {
  dynRead,
  type OptNode,
  optimize,
  precompute,
  prod,
  sum,
  threshold,
} from '@genshin-optimizer/gi/wr'
import {
  type CleanupTopProblem,
  cleanupAllowedSets,
  prepareCleanupTopProblem,
  solveCleanupTopBuilds,
} from './ArtifactCleanupTopBuilds'
import { runCleanupTopBuilds } from './ArtifactCleanupWorkerClient.mjs'

const sets = ['GladiatorsFinale', 'NoblesseOblige', 'WanderersTroupe'] as const
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}
function makeArts(seed: number, perSlot: number): ArtifactsBySlot {
  const next = random(seed)
  const values = Object.fromEntries(
    allArtifactSlotKeys.map((slot) => [
      slot,
      Array.from({ length: perSlot }, (_, i) => {
        const set = sets[Math.floor(next() * sets.length)]
        return {
          id: `${slot}${i}`,
          set,
          values: {
            [set]: 1,
            atk_: Math.round(next() * 20) / 100,
            critRate_: Math.round(next() * 20) / 100,
            enerRech_: Math.round(next() * 20) / 100,
          },
        } as ArtifactBuildData
      }),
    ])
  ) as ArtifactsBySlot['values']
  return {
    base: Object.fromEntries(
      [...sets, 'atk_', 'critRate_', 'enerRech_'].map((key) => [key, 0])
    ),
    values,
  }
}
function makeProblem(
  arts: ArtifactsBySlot,
  exclusion: ArtSetExclusion,
  minimumER: number,
  topN: number
): CleanupTopProblem {
  const target = prod(
    sum(1, dynRead('atk_'), threshold(dynRead('GladiatorsFinale'), 4, 0.3, 0)),
    sum(1, dynRead('critRate_'))
  )
  const nodes = optimize(
    [
      target,
      sum(
        dynRead('enerRech_'),
        threshold(dynRead('NoblesseOblige'), 2, 0.2, 0)
      ),
    ],
    {},
    ({ path: [path] }) => path !== 'dyn'
  ) as OptNode[]
  return {
    nodes,
    minimum: [Number.NEGATIVE_INFINITY, minimumER],
    arts,
    exclusion,
    topN,
  }
}
function bruteForce(problem: CleanupTopProblem) {
  const evaluate = precompute(problem.nodes, {}, (node) => node.path[1], 5)
  const builds: { value: number; ids: string[] }[] = []
  const pools = allArtifactSlotKeys.map((slot) => problem.arts.values[slot])
  const visit = (depth: number, buffer: ArtifactBuildData[]) => {
    if (depth === 5) {
      if (!cleanupAllowedSets(buffer, problem.exclusion)) return
      const [value, er] = evaluate(
        buffer as ArtifactBuildData[] & { length: 5 }
      )
      if (er < problem.minimum[1]) return
      builds.push({ value, ids: buffer.map(({ id }) => id) })
      return
    }
    for (const art of pools[depth]) visit(depth + 1, [...buffer, art])
  }
  visit(0, [])
  return builds.sort((a, b) => b.value - a.value).slice(0, problem.topN)
}

describe('cleanup top builds', () => {
  test.each([
    [1, {}, 0, 5],
    [2, { rainbow: [2, 4] }, 0, 8],
    [3, { NoblesseOblige: [4] }, 0.5, 6],
    [4, { GladiatorsFinale: [2] }, 0.3, 3],
  ] as const)('matches exhaustive enumeration (seed %i)', async (seed, exclusion, minimumER, topN) => {
    const problem = makeProblem(
      makeArts(seed, 5),
      exclusion as ArtSetExclusion,
      minimumER,
      topN
    )
    const expected = bruteForce(problem)
    const actual = await runCleanupTopBuilds(problem)
    expect(actual.complete).toBe(true)
    expect(actual.builds.map(({ value }) => value)).toEqual(
      expected.map(({ value }) => expect.closeTo(value, 9))
    )
    // Pieces of builds strictly above the cut-off are found regardless of ties.
    const cutoff = expected[expected.length - 1]?.value ?? 0
    const required = new Set(
      expected
        .filter(({ value }) => value > cutoff + 1e-9)
        .flatMap(({ ids }) => ids)
    )
    const found = new Set(
      actual.builds.flatMap(({ artifactIds }) => artifactIds)
    )
    for (const id of required) expect(found.has(id)).toBe(true)
    // Pruned pieces are never part of a top build.
    for (const id of found) expect(actual.remainingIds.has(id)).toBe(true)
  })
  test('a time limit leaves only unpruned pieces unresolved', async () => {
    const problem = makeProblem(makeArts(5, 6), {}, 0, 2)
    const setup = prepareCleanupTopProblem(problem)
    const result = await solveCleanupTopBuilds(setup, {}, 2, { maxMs: 0 })
    expect(result.complete).toBe(false)
    expect(result.builds).toEqual([])
    expect(result.remainingIds.size).toBeLessThan(30)
  })
  test('cancellation stops the search', async () => {
    const problem = makeProblem(makeArts(6, 4), {}, 0, 2)
    await expect(
      runCleanupTopBuilds(problem, { shouldCancel: () => true })
    ).rejects.toThrow('cancelled')
  })
})
