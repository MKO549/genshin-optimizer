import { GOSolver, mergeBuilds } from '@genshin-optimizer/gi/solver'
import {
  analyzeCleanupProfiles,
  type CleanupReservations,
} from './ArtifactCleanupProfiles.js'
import {
  type CleanupTopProblem,
  type CleanupTopProgress,
  type CleanupTopResult,
  prepareCleanupTopProblem,
  solveCleanupTopBuilds,
} from './ArtifactCleanupTopBuilds.js'

export async function runCleanupProfiles({
  shouldCancel = () => false,
  onProgress,
  ...input
}: Parameters<typeof analyzeCleanupProfiles>[0]): Promise<CleanupReservations> {
  if (typeof Worker === 'undefined')
    return analyzeCleanupProfiles({ ...input, shouldCancel, onProgress })
  const worker = new Worker(
    new URL('./ArtifactCleanupProfilesWorker.ts', import.meta.url),
    { type: 'module' }
  )
  let timer: ReturnType<typeof setInterval> | undefined
  try {
    return await new Promise<CleanupReservations>((resolve, reject) => {
      timer = setInterval(() => {
        if (shouldCancel()) reject(new Error('Cleanup cancelled'))
      }, 30)
      worker.onerror = (event) =>
        reject(new Error(event.message || 'Cleanup profile worker failed'))
      worker.onmessage = ({ data }) => {
        if (shouldCancel()) {
          reject(new Error('Cleanup cancelled'))
          return
        }
        if (data.error) reject(new Error(data.error))
        else if (data.result) resolve(data.result)
        else if (data.progress)
          onProgress?.(data.progress.current, data.progress.total)
      }
      worker.postMessage(input)
    })
  } finally {
    clearInterval(timer)
    worker.terminate()
  }
}

/** One optimizer run per build. Uses the regular GO solver workers in the
 * browser, and an equivalent single-thread search without `Worker` (tests). */
export async function runCleanupTopBuilds(
  problem: CleanupTopProblem,
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
  const setup = prepareCleanupTopProblem(problem)
  const { exclusion, topN } = problem
  if (typeof Worker === 'undefined')
    return solveCleanupTopBuilds(setup, exclusion, topN, {
      shouldCancel,
      maxMs,
      onProgress,
    })
  const { remainingIds } = setup
  if (!Object.values(setup.arts.values).every((slot) => slot.length))
    return { builds: [], complete: true, remainingIds }
  const started = performance.now()
  const status = {
    tested: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    testedPerSecond: 0,
    skippedPerSecond: 0,
  }
  const solver = new GOSolver(
    {
      arts: setup.arts,
      optimizationTarget: setup.optTarget,
      constraints: setup.constraints,
      exclusion,
      topN,
    },
    status,
    Math.max(1, (navigator.hardwareConcurrency || 4) - 1)
  )
  const cancelled = new Error('Cleanup cancelled')
  const limited = new Error('Cleanup time limit')
  const timer = setInterval(() => {
    if (shouldCancel()) solver.cancel(cancelled)
    else if (performance.now() - started >= maxMs) solver.cancel(limited)
    else
      onProgress?.({
        elapsedMs: performance.now() - started,
        tested: status.tested,
      })
  }, 50)
  try {
    const results = await solver.solve()
    return {
      builds: mergeBuilds(
        results.map(({ builds }) => builds),
        topN
      ),
      complete: true,
      remainingIds,
    }
  } catch (error) {
    if (error === limited) return { builds: [], complete: false, remainingIds }
    throw error === cancelled || shouldCancel() ? cancelled : error
  } finally {
    clearInterval(timer)
    solver.cancel()
  }
}
