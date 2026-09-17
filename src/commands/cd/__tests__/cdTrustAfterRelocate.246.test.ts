import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import * as realAnalytics from '../../../services/analytics/index.js'
import * as realSessionStorage from '../../../utils/sessionStorage.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)

const sessionStorageSnap = snapshotModuleExports(realSessionStorage)
const analyticsSnap = snapshotModuleExports(realAnalytics)

let failTranscript = false
mock.module('src/utils/sessionStorage.js', () => ({
  ...sessionStorageSnap,
  relocateSessionTranscript: async () => {
    if (failTranscript) {
      throw new Error('transcript relocate failed')
    }
    return sessionStorageSnap.relocateSessionTranscript()
  },
}))
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: () => {},
}))

afterAll(() => {
  mock.module('src/utils/sessionStorage.js', () => ({ ...sessionStorageSnap }))
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
})

const { call, handleSetCwdControlRequest, isDirectoryTrusted } = await import(
  '../cdCommand.js'
)
const {
  getSessionId,
  getSessionProjectDir,
  setCwdState,
  setOriginalCwd,
  switchSession,
} = await import('../../../bootstrap/state.js')
const { getProjectPathForConfig } = await import('../../../utils/config.js')

const temps: string[] = []
const suiteCwd = process.cwd()
const suiteSessionId = getSessionId()
const suiteSessionProjectDir = getSessionProjectDir()

afterEach(() => {
  failTranscript = false
  try {
    process.chdir(suiteCwd)
  } catch {
    // ignore
  }
  setCwdState(suiteCwd)
  setOriginalCwd(suiteCwd)
  switchSession(suiteSessionId, suiteSessionProjectDir)
  getProjectPathForConfig.cache?.clear?.()
})

function makeContext() {
  return {
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
    reloadPlugins: async () => {},
  } as Parameters<typeof call>[1]
}

describe('densable /cd trust latch after successful relocate', () => {
  test('Yes + transcript relocate rollback does not latch dest trust', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-trust-fail-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-trust-fail-b-'))
    temps.push(a, b)
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    expect(isDirectoryTrusted(b)).toBe(false)

    const node = await call(() => {}, makeContext(), b)
    expect(node).toEqual(
      expect.objectContaining({
        props: expect.objectContaining({
          onConfirm: expect.any(Function),
        }),
      }),
    )
    failTranscript = true
    const next = await (
      node as { props: { onConfirm: () => Promise<unknown> } }
    ).props.onConfirm()
    expect(next).toBeNull()
    expect(isDirectoryTrusted(b)).toBe(false)
    expect(process.cwd()).toBe(a)
  })

  test('set_cwd trust_accepted + relocate rollback does not latch dest trust', async () => {
    const a = mkdtempSync(join(tmpdir(), 'cd-setcwd-fail-a-'))
    const b = mkdtempSync(join(tmpdir(), 'cd-setcwd-fail-b-'))
    temps.push(a, b)
    setCwdState(a)
    setOriginalCwd(a)
    process.chdir(a)
    const host = {
      isBusy: () => false,
      toolPermissionContext: getEmptyToolPermissionContext(),
      enqueueMoveNotice: () => {},
    }
    const need = await handleSetCwdControlRequest(
      { subtype: 'set_cwd', path: b },
      host,
    )
    expect(need).toEqual(
      expect.objectContaining({
        kind: 'response',
        response: expect.objectContaining({ status: 'needs_trust' }),
      }),
    )
    const trustedDirectory =
      need.kind === 'response' && need.response.status === 'needs_trust'
        ? need.response.directory
        : b
    failTranscript = true
    await expect(
      handleSetCwdControlRequest(
        {
          subtype: 'set_cwd',
          path: b,
          trust_accepted: true,
          trusted_directory: trustedDirectory,
        },
        host,
      ),
    ).rejects.toThrow('transcript relocate failed')
    expect(isDirectoryTrusted(b)).toBe(false)
    expect(process.cwd()).toBe(a)
  })
})
