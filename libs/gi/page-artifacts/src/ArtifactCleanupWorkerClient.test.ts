import { initialArtifactCleanupConfig } from '@genshin-optimizer/gi/db'
import { vi } from 'vitest'
import { runCleanupProfiles } from './ArtifactCleanupWorkerClient.mjs'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('profile workers return structured maps and release their resources', async () => {
  const terminate = vi.fn()
  const result = {
    matches: new Map(),
    reservations: new Map(),
    assignedMatches: new Map(),
    coveredCharacters: new Set(),
    invalidArtifactIds: new Set(),
    invalidProfileCharacters: new Set(),
    warnings: [],
    incompleteGroups: [],
  }
  class WorkerMock {
    onmessage?: (event: { data: unknown }) => void
    terminate = terminate
    postMessage() {
      queueMicrotask(() => this.onmessage?.({ data: { result } }))
    }
  }
  vi.stubGlobal('Worker', WorkerMock)
  const actual = await runCleanupProfiles({
    artifacts: [],
    config: initialArtifactCleanupConfig(),
    relevantCharacters: [],
  })
  expect(actual).toBe(result)
  expect(terminate).toHaveBeenCalledOnce()
})
