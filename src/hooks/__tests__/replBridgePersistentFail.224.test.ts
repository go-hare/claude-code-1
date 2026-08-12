/**
 * densable 2.1.224 #22 — RC connection failures keep a persistent failure
 * indicator (replBridgeError) with reconnect copy; auto-disable must NOT clear
 * the error (pre-224 local cleared after 10s = toast-only).
 *
 * densable: GKT=1e4; nr() sets replBridgeEnabled:!1 without clearing error;
 * qe() appends "run /remote-control to reconnect"; FAILED footer "Run /remote-control to retry".
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const hookPath = join(import.meta.dir, '../useReplBridge.tsx')
const hook = readFileSync(hookPath, 'utf8')
const statusPath = join(import.meta.dir, '../../bridge/bridgeStatusUtil.ts')
const status = readFileSync(statusPath, 'utf8')
const storePath = join(import.meta.dir, '../../state/AppStateStore.ts')
const store = readFileSync(storePath, 'utf8')

describe('densable 2.1.224 #22 persistent RC fail indicator', () => {
  test('BRIDGE_FAILURE_DISMISS_MS is 10s (densable GKT=1e4)', () => {
    expect(hook).toMatch(/BRIDGE_FAILURE_DISMISS_MS\s*=\s*10_000/)
  })

  test('scheduleBridgeAutoDisable keeps replBridgeError (does not clear)', () => {
    expect(hook).toContain('function scheduleBridgeAutoDisable')
    const start = hook.indexOf('function scheduleBridgeAutoDisable')
    expect(start).toBeGreaterThan(-1)
    const body = hook.slice(start, start + 700)
    expect(body).toContain('replBridgeEnabled: false')
    // densable pin: must not wipe error on the dismiss timer
    expect(body).not.toMatch(/replBridgeError:\s*undefined/)
    expect(body).toContain('do NOT clear replBridgeError')
  })

  test('surfaceBridgeFailure sets error + kind and schedules auto-disable', () => {
    expect(hook).toContain('function surfaceBridgeFailure')
    expect(hook).toContain('replBridgeErrorKind')
    expect(hook).toContain("kind = opts?.kind ?? 'terminal'")
    expect(hook).toContain('scheduleBridgeAutoDisable()')
    // failed state uses surfaceBridgeFailure (not toast-only setTimeout clear)
    const failedIdx = hook.indexOf("case 'failed'")
    expect(failedIdx).toBeGreaterThan(-1)
    const failedSlice = hook.slice(failedIdx, failedIdx + 350)
    expect(failedSlice).toContain('surfaceBridgeFailure')
  })

  test('reconnect transcript copy matches densable qe template', () => {
    expect(hook).toContain('function appendBridgeDisconnectMessage')
    expect(hook).toContain('run /remote-control to reconnect')
    expect(hook).toContain('Remote Control disconnected')
    // action-aware omit of reconnect clause
    expect(hook).toContain("detail.includes('/login')")
    expect(hook).toContain("detail.includes('/remote-control')")
  })

  test('AppState declares replBridgeErrorKind', () => {
    expect(store).toContain('replBridgeErrorKind: string | undefined')
    expect(store).toContain('replBridgeErrorKind: undefined')
  })

  test('FAILED_FOOTER_TEXT is densable reconnect shortcut', () => {
    expect(status).toContain(
      "FAILED_FOOTER_TEXT = 'Run /remote-control to retry'",
    )
    expect(status).not.toContain('Something went wrong, please try again')
  })

  test('fuse path sets terminal error without clearing on timer', () => {
    expect(hook).toContain('BRIDGE_FUSE_HINT')
    expect(hook).toContain("replBridgeErrorKind: 'terminal'")
    expect(hook).toContain(
      'disabled after repeated failures · restart to retry',
    )
  })
})
