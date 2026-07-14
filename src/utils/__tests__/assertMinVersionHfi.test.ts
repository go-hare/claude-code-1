import { afterEach, describe, expect, mock, test } from 'bun:test'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  mock.restore()
})

describe('assertMinVersion HFI densable', () => {
  test('shouldSkipHfiVersionCheck short-circuits assertMinVersion', async () => {
    process.env.NODE_ENV = 'production'
    process.env.CLAUDE_CODE_SKIP_HFI_VERSION_CHECK = '1'

    // Import after env so residual gate reads truthy skip.
    const { assertMinVersion } = await import('../autoUpdater.js')
    // Must not throw / exit — skip returns early before GrowthBook.
    await assertMinVersion()
  })
})
