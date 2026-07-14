import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stopActiveSyncerForTest } from '../syncedFileSyncer.js'
import {
  maybeStartWorkingSync,
  shouldStartWorkingSync,
} from '../workingSyncGate.js'

describe('workingSyncGate densable', () => {
  afterEach(() => {
    stopActiveSyncerForTest()
  })

  test('requires sdkUrl + REMOTE_SESSION_ID + no ENVIRONMENT_KIND + not disabled', () => {
    expect(
      shouldStartWorkingSync({
        sdkUrl: 'wss://x',
        env: { CLAUDE_CODE_REMOTE_SESSION_ID: 'sid' },
      }),
    ).toBe(true)
    expect(
      shouldStartWorkingSync({
        sdkUrl: null,
        env: { CLAUDE_CODE_REMOTE_SESSION_ID: 'sid' },
      }),
    ).toBe(false)
    expect(
      shouldStartWorkingSync({
        sdkUrl: 'wss://x',
        env: {},
      }),
    ).toBe(false)
    expect(
      shouldStartWorkingSync({
        sdkUrl: 'wss://x',
        env: {
          CLAUDE_CODE_REMOTE_SESSION_ID: 'sid',
          CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge',
        },
      }),
    ).toBe(false)
    expect(
      shouldStartWorkingSync({
        sdkUrl: 'wss://x',
        env: {
          CLAUDE_CODE_REMOTE_SESSION_ID: 'sid',
          CLAUDE_CODE_DISABLE_WORKING_SYNC: '1',
        },
      }),
    ).toBe(false)
  })

  test('maybeStartWorkingSync wires requestSyncedFile put densable', async () => {
    const root = join(
      tmpdir(),
      `cc-wsync-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await mkdir(root, { recursive: true })
    try {
      await writeFile(join(root, 'a.txt'), 'hello')
      const puts: Array<{ path?: string; method?: string }> = []
      maybeStartWorkingSync({
        sdkUrl: 'wss://x',
        env: { CLAUDE_CODE_REMOTE_SESSION_ID: 'sid' },
        root,
        workerEpoch: 7,
        requestSyncedFile: async args => {
          puts.push({ method: args.method, path: args.path })
          return {
            ok: true,
            status: 200,
            data: { content_sha256: 'etag' },
          }
        },
      })
      // Fire-and-forget — wait for initial scan.
      await new Promise(r => setTimeout(r, 200))
      expect(puts.some(p => p.method === 'put')).toBe(true)
      expect(puts.some(p => p.path === '/worker/synced_file')).toBe(true)
    } finally {
      stopActiveSyncerForTest()
      await rm(root, { recursive: true, force: true })
    }
  })
})
