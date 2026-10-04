/**
 * densable 2.1.283 leftover gold `hn`/`fn` directory-sync handle wrap.
 * No laptop FS pull engine — takeDirSync/releaseDirSync seams only.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { analyticsMock } from '../../../tests/mocks/analytics.js'
import { debugMock } from '../../../tests/mocks/debug.js'

const debugLogs: string[] = []
function debugWithCapture() {
  return {
    ...debugMock(),
    logForDebugging: (msg: string) => {
      debugLogs.push(msg)
    },
  }
}
mock.module('../../utils/debug.js', debugWithCapture)
mock.module('../../utils/debug.ts', debugWithCapture)
mock.module('src/utils/debug.js', debugWithCapture)
mock.module('src/utils/debug.ts', debugWithCapture)
mock.module('../../services/analytics/index.js', () => analyticsMock())
mock.module('../../services/analytics/index.ts', () => analyticsMock())
mock.module('src/services/analytics/index.js', () => analyticsMock())
mock.module('src/services/analytics/index.ts', () => analyticsMock())

const {
  createStoppedLaptopDirSyncSession,
  releaseDirectorySyncHandle,
  takeDirectorySyncHandle,
} = await import('../dirSyncLookup.js')

const body = readFileSync(join(import.meta.dir, '../dirSyncLookup.ts'), 'utf8')
const sessionBody = readFileSync(
  join(import.meta.dir, '../cloudSession.ts'),
  'utf8',
)

afterEach(() => {
  debugLogs.length = 0
})

describe('leftover dir-sync handle hn/fn 283', () => {
  test('source-locks gold hn/fn unique logs and cloudSession re-export', () => {
    expect(body).toContain('gold `hn` @202412591')
    expect(body).toContain('gold `fn` @202412770')
    expect(body).toContain('[headlessCloud] directory-sync handle unavailable:')
    expect(body).toContain(
      '[headlessCloud] directory-sync handle not released:',
    )
    expect(body).toContain('takeDirSync')
    expect(body).toContain('releaseDirSync')
    expect(body).not.toMatch(/^export function hn\b/m)
    expect(body).not.toMatch(/^export function fn\b/m)
    expect(body).not.toContain('openLaptopGitSync')
    expect(sessionBody).toContain("from './dirSyncLookup.js'")
    expect(sessionBody).toContain('takeDirectorySyncHandle')
    expect(sessionBody).toContain('releaseDirectorySyncHandle')
  })

  test('hn undefined take is void; rejected take logs unavailable', async () => {
    expect(await takeDirectorySyncHandle('cse_1')).toBeUndefined()
    expect(debugLogs).toEqual([])
    const handle = await takeDirectorySyncHandle('cse_1', {
      takeDirSync: () => Promise.reject(new Error('missing')),
    })
    expect(handle).toBeUndefined()
    expect(debugLogs).toEqual([
      '[headlessCloud] directory-sync handle unavailable: missing',
    ])
  })

  test('fn skips undefined; releases sessionId; logs not released', async () => {
    await releaseDirectorySyncHandle(undefined)
    expect(debugLogs).toEqual([])
    const stopped = createStoppedLaptopDirSyncSession({
      sessionId: 'session_abc',
      gitRoot: '/tmp',
      engine: { kind: 'stopped', reason: 'engine_declined', line: 'off' },
    })
    const released: string[] = []
    await releaseDirectorySyncHandle(stopped, {
      releaseDirSync: id => {
        released.push(id)
      },
    })
    expect(released).toEqual(['cse_abc'])
    await releaseDirectorySyncHandle(Promise.reject(new Error('held')))
    expect(debugLogs).toEqual([
      '[headlessCloud] directory-sync handle not released: held',
    ])
  })
})
