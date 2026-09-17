/**
 * densable 2.1.246 — `authChangeGeneration` default 0 + `/login` increment
 * + `$e` generation abort + account-switch RC disconnect.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const storeSrc = readFileSync(
  join(import.meta.dir, '../../state/AppStateStore.ts'),
  'utf8',
)
const loginSrc = readFileSync(
  join(import.meta.dir, '../../commands/login/login.tsx'),
  'utf8',
)
const hookSrc = readFileSync(
  join(import.meta.dir, '../useReplBridge.tsx'),
  'utf8',
)

describe('densable 2.1.246 authChangeGeneration', () => {
  test('AppState defaults to 0 next to replBridgeErrorKind', () => {
    expect(storeSrc).toContain('authChangeGeneration: number')
    expect(storeSrc).toContain('authChangeGeneration: 0')
  })

  test('/login increments generation and disconnects RC on account switch', () => {
    expect(loginSrc).toContain(
      'authChangeGeneration: prev.authChangeGeneration + 1',
    )
    expect(loginSrc).toContain(
      '[bridge:repl] Account changed via /login — disconnecting Remote Control session',
    )
    expect(loginSrc).toContain('previousAccount')
    // s() / authVersion must not live inside the gated disconnect return.
    expect(loginSrc).not.toMatch(
      /Account changed via \/login[\s\S]{0,400}authChangeGeneration:/,
    )
  })

  test('useReplBridge $e snapshots generation and aborts mid-flight', () => {
    expect(hookSrc).toContain('authFailGenerationRef')
    expect(hookSrc).toContain('AUTH_FAIL_TOKEN_LOADING')
    expect(hookSrc).toContain(
      'store.getState().authChangeGeneration !== authFailGenerationRef.current',
    )
    expect(hookSrc).toContain('s => s.authChangeGeneration')
    expect(hookSrc).toContain(
      'authFailTokenRef.current === AUTH_FAIL_TOKEN_LOADING',
    )
  })

  test('auth-revive sK kill-switch and Qtt=10 cap', () => {
    expect(hookSrc).toContain(
      "getFeatureValue_CACHED_MAY_BE_STALE('tengu_bridge_auth_revive', true)",
    )
    expect(hookSrc).toContain('const AUTH_REVIVE_CAP = 10')
    expect(hookSrc).toContain('authReviveCountRef.current++')
    expect(hookSrc).toContain(
      '[bridge:repl] Auth-revive watcher: kill switch off — still polling, no unattended revive',
    )
    expect(hookSrc).toContain(
      '[bridge:repl] Auth-revive watcher: non-interactive revive brake engaged — still polling; an in-process /login bypasses',
    )
  })
})
