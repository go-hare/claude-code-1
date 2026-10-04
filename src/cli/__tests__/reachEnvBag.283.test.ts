/**
 * densable 2.1.283 leftover gold `SSn` @202277244 + `_Sn` @202276620 wrap.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  emptyReachMemory,
  isReachEnvScopePinned,
  mergeReachEnv,
  reachEnvShellPrefix,
} from '../reachEnvBag.js'

const src = readFileSync(join(import.meta.dir, '../reachEnvBag.ts'), 'utf8')

describe('reachEnvBag 283 leftover gold SSn/_Sn wrap', () => {
  test('source-locks gold SSn/_Sn unique strings; no minify public API', () => {
    expect(src).toContain('gold `SSn` @202277244')
    expect(src).toContain('gold `_Sn` @202276620')
    expect(src).toContain('pinnedScopes')
    expect(src).toContain('everInReach')
    expect(src).toContain('stickyRoots')
    expect(src).toContain('CLAUDE_CODE_SHELL_PREFIX')
    expect(src).toContain('getSettingsForSource')
    expect(src).not.toMatch(/^export (async )?function SSn\b/m)
    expect(src).not.toMatch(/^export (async )?function _Sn\b/m)
    expect(src).not.toContain('settings.set(')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).not.toContain('new WebSocket')
  })

  test('_Sn trim; contrast Dt startsWith("/") not merged', () => {
    expect(reachEnvShellPrefix({})).toBeUndefined()
    expect(
      reachEnvShellPrefix({ CLAUDE_CODE_SHELL_PREFIX: '  ' }),
    ).toBeUndefined()
    expect(
      reachEnvShellPrefix({ CLAUDE_CODE_SHELL_PREFIX: ' timeout 30 ' }),
    ).toBe('timeout 30')
    expect(src).toContain('Dt')
    expect(src).toContain('startsWith("/")')
    expect(src).not.toContain('n.startsWith("/")?n:void 0')
  })

  test('SSn pin user/flag via everInReach; stickyRoots skip leftover env', () => {
    const memory = emptyReachMemory()
    expect(isReachEnvScopePinned(memory, 'userSettings')).toBe(false)
    memory.everInReach.add('user')
    expect(isReachEnvScopePinned(memory, 'userSettings')).toBe(true)
    memory.everInReach.add('flag')
    expect(isReachEnvScopePinned(memory, 'flagSettings')).toBe(true)
    memory.pinnedScopes.add('policySettings')
    expect(isReachEnvScopePinned(memory, 'policySettings')).toBe(true)

    const merged = mergeReachEnv(
      memory,
      {
        path: '/tmp/legacy.json',
        real: '/tmp/legacy.json',
        env: { FROM_LEGACY: '1', SHARED: 'legacy' },
      },
      scope =>
        scope === 'userSettings'
          ? { FROM_USER: '1' }
          : scope === 'policySettings'
            ? { FROM_POLICY: '1' }
            : scope === 'flagSettings'
              ? { FROM_FLAG: '1' }
              : { FROM_PROJECT: '1' },
    )
    expect(merged.FROM_LEGACY).toBe('1')
    expect(merged.FROM_USER).toBeUndefined()
    expect(merged.FROM_FLAG).toBeUndefined()
    expect(merged.FROM_POLICY).toBeUndefined()
    expect(merged.FROM_PROJECT).toBeUndefined()

    memory.stickyRoots.add('/tmp/legacy.json')
    const skipped = mergeReachEnv(
      emptyReachMemory(),
      {
        path: '/tmp/legacy.json',
        real: '/tmp/legacy.json',
        env: { FROM_LEGACY: '1' },
      },
      () => ({ FROM_POLICY: 'p' }),
    )
    expect(skipped.FROM_LEGACY).toBe('1')
    const sticky = mergeReachEnv(
      memory,
      {
        path: '/tmp/legacy.json',
        real: '/tmp/legacy.json',
        env: { FROM_LEGACY: '1' },
      },
      () => undefined,
    )
    expect(sticky.FROM_LEGACY).toBeUndefined()
  })
})
