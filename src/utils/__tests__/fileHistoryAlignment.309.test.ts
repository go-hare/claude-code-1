import { describe, expect, test } from 'bun:test'
import {
  fileHistoryGetDiffStats,
  type FileHistoryState,
} from '../fileHistory.js'

describe('2.1.309 FileHistory alignment (#1140)', () => {
  test('#1140 fileHistoryGetDiffStats marks hasUncheckedFiles when backupFileName is missing', async () => {
    const orig = process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
    const origSdk = process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING
    delete process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING
    process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = '1'
    try {
      const state: FileHistoryState = {
        snapshots: [
          {
            messageId: '00000000-0000-0000-0000-000000000001',
            trackedFileBackups: {},
            timestamp: new Date(),
          },
        ],
        trackedFiles: new Set(['/nonexistent-unchecked-file.ts']),
        snapshotSequence: 1,
      }
      const stats = await fileHistoryGetDiffStats(
        state,
        '00000000-0000-0000-0000-000000000001',
      )
      expect(stats).toBeDefined()
      expect(stats?.hasUncheckedFiles).toBe(true)
    } finally {
      if (orig !== undefined) {
        process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = orig
      }
      if (origSdk !== undefined) {
        process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = origSdk
      } else {
        delete process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING
      }
    }
  })
})
