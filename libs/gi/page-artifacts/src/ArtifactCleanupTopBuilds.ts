import {
  type ArtifactSetKey,
  allArtifactSlotKeys,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtSetExclusion,
  ArtSetExclusionKey,
} from '@genshin-optimizer/gi/db'
import {
  type ArtifactBuildData,
  type ArtifactsBySlot,
  artSetPerm,
  ComputeWorker,
  filterFeasiblePerm,
  pruneAll,
  pruneExclusion,
  type SolverBuild,
} from '@genshin-optimizer/gi/solver'
import { type OptNode, optimize } from '@genshin-optimizer/gi/wr'

export type CleanupTopProblem = {
  nodes: OptNode[] // target first, followed by minimum constraints
  minimum: number[]
  arts: ArtifactsBySlot
  exclusion: ArtSetExclusion
  topN: number
}
export type CleanupTopSetup = {
  arts: ArtifactsBySlot
  optTarget: OptNode
  constraints: { value: OptNode; min: number }[]
  /** Pieces that survived optimizer pruning. Pruned pieces cannot be in the top N. */
  remainingIds: Set<string>
}
export type CleanupTopResult = {
  builds: SolverBuild[]
  /** False when the run stopped early; only pruned pieces are then proven. */
  complete: boolean
  remainingIds: Set<string>
}
export type CleanupTopProgress = { elapsedMs: number; tested: number }

/** Set rules apply to the complete combination, never a one-slot replacement. */
export function cleanupAllowedSets(
  arts: { set?: ArtifactBuildData['set'] }[],
  exclusion: ArtSetExclusion
) {
  const counts = new Map<ArtifactSetKey, number>()
  for (const art of arts)
    if (art.set && !art.set.startsWith('Prayers'))
      counts.set(art.set, (counts.get(art.set) ?? 0) + 1)
  for (const [set, count] of counts) {
    const excluded = exclusion[set as ArtSetExclusionKey] ?? []
    if (
      (count >= 4 && excluded.includes(4)) ||
      (count >= 2 && count < 4 && excluded.includes(2))
    )
      return false
  }
  const rainbow = [...counts.values()].reduce(
    (sum, count) => sum + (count % 2),
    0
  )
  return !(
    (rainbow >= 4 && exclusion.rainbow?.includes(4)) ||
    (rainbow >= 2 && rainbow < 4 && exclusion.rainbow?.includes(2))
  )
}

/** Mirrors `GOSolver.preprocess`, so the pruned pool is known even if the
 * full solver run is later stopped by its time limit. */
export function prepareCleanupTopProblem({
  nodes: [target, ...constraintNodes],
  minimum,
  arts,
  exclusion,
  topN,
}: CleanupTopProblem): CleanupTopSetup {
  const constraints = constraintNodes
    .map((value, i) => ({ value, min: minimum[i + 1] }))
    .filter(({ min }) => min > Number.NEGATIVE_INFINITY)
  let nodes = [...constraints.map(({ value }) => value), target]
  const minimums = [
    ...constraints.map(({ min }) => min),
    Number.NEGATIVE_INFINITY,
  ]
  nodes = pruneExclusion(nodes, exclusion)
  nodes = optimize(nodes, {}, (_) => false)
  ;({ nodes, arts } = pruneAll(nodes, minimums, arts, topN, exclusion, {
    reaffine: true,
    pruneArtRange: true,
    pruneNodeRange: true,
    pruneOrder: true,
  }))
  nodes = optimize(nodes, {}, (_) => false)
  const optTarget = nodes.pop()!
  return {
    arts,
    optTarget,
    constraints: nodes.map((value, i) => ({ value, min: minimums[i] })),
    remainingIds: new Set(
      Object.values(arts.values).flatMap((slot) => slot.map(({ id }) => id))
    ),
  }
}

/** Single-thread top-N search for environments without `Worker` (tests). */
export async function solveCleanupTopBuilds(
  setup: CleanupTopSetup,
  exclusion: ArtSetExclusion,
  topN: number,
  {
    shouldCancel = () => false,
    maxMs = Number.POSITIVE_INFINITY,
    onProgress,
  }: {
    shouldCancel?: () => boolean
    maxMs?: number
    onProgress?: (progress: CleanupTopProgress) => void
  } = {}
): Promise<CleanupTopResult> {
  const started = performance.now()
  const { remainingIds } = setup
  if (!allArtifactSlotKeys.every((slot) => setup.arts.values[slot].length))
    return { builds: [], complete: true, remainingIds }
  let tested = 0
  const worker = new ComputeWorker(
    { command: 'setup', ...setup, plotBase: undefined, topN },
    (interim) => (tested += interim.tested)
  )
  const perms = filterFeasiblePerm(
    artSetPerm(
      exclusion,
      new Set(
        Object.values(setup.arts.values).flatMap((slot) =>
          slot.map(({ set }) => set!)
        )
      )
    ),
    setup.arts
  )
  for (const filter of perms) {
    if (shouldCancel()) throw new Error('Cleanup cancelled')
    if (performance.now() - started >= maxMs)
      return { builds: [], complete: false, remainingIds }
    worker.compute(filter)
    onProgress?.({ elapsedMs: performance.now() - started, tested })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  worker.refresh(true)
  return { builds: worker.builds, complete: true, remainingIds }
}
