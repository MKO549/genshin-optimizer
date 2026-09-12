import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '../ArtCharDatabase'

describe('ArtifactCleanupConfigEntry', () => {
  test('uses defaults and participates in the normal database export/import', () => {
    const source = new ArtCharDatabase(1, new SandboxStorage())
    expect(source.artifactCleanup.get()).toMatchObject({
      version: 1,
      demandMargin: 1,
      fillerCap: 1,
    })

    source.artifactCleanup.set({ demandMargin: 2 })
    const exported = source.exportGOOD()
    expect(exported.artifact_cleanup_config).toMatchObject({
      version: 1,
      demandMargin: 2,
    })

    const target = new ArtCharDatabase(2, new SandboxStorage())
    target.importGOOD(exported, true, true, false)
    expect(target.artifactCleanup.get().demandMargin).toBe(2)
  })
})
