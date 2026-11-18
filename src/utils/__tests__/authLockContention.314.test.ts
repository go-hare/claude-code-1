import { describe, expect, test } from 'bun:test'
import {
  inspectOAuthRefreshLock,
  isSameOAuthRefreshLockSnapshot,
} from '../auth.js'

describe('v2.1.314 #1366 OAuth refresh lock inspection', () => {
  test('isSameOAuthRefreshLockSnapshot compares mtimeMs and contendedLock', () => {
    const a = {
      contendedLock: 'current' as const,
      lockAgeMs: 100,
      mtimeMs: 12345,
    }
    const b = {
      contendedLock: 'current' as const,
      lockAgeMs: 200,
      mtimeMs: 12345,
    }
    const c = {
      contendedLock: 'current' as const,
      lockAgeMs: 200,
      mtimeMs: 12346,
    }
    expect(isSameOAuthRefreshLockSnapshot(a, b)).toBe(true)
    expect(isSameOAuthRefreshLockSnapshot(a, c)).toBe(false)
    expect(
      isSameOAuthRefreshLockSnapshot(
        { contendedLock: 'current', lockAgeMs: undefined, mtimeMs: undefined },
        a,
      ),
    ).toBe(false)
  })

  test('inspectOAuthRefreshLock handles missing lockfile gracefully', async () => {
    const snap = await inspectOAuthRefreshLock(
      {},
      '/tmp/nonexistent-claude-dir-314',
    )
    expect(snap.contendedLock).toBe('current')
    expect(snap.mtimeMs).toBeUndefined()
  })
})
