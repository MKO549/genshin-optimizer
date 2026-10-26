import { analyzeCleanupProfiles } from './ArtifactCleanupProfiles'

self.onmessage = async ({
  data,
}: MessageEvent<Parameters<typeof analyzeCleanupProfiles>[0]>) => {
  try {
    const result = await analyzeCleanupProfiles({
      ...data,
      onProgress: (current, total) =>
        self.postMessage({ progress: { current, total } }),
    })
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
