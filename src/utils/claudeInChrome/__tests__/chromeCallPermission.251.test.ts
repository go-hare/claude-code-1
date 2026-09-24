/**
 * densable 2.1.251 #57 — chrome call permission four-arm + Pvr bag.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  chromeDomainSetsFromContext,
  chromePermissionModeFromSession,
  createChromeOnPermissionRequest,
  normalizeChromeHost,
  resolveChromeCallPermissionOverrides,
} from '../chromeCallPermission.js'
import {
  getChromeInstallSessionState,
  rememberResolvedChromeHost,
  resetChromeInstallSessionState,
} from '../sessionState.js'

describe('densable 2.1.251 #57 chrome call permission', () => {
  test('normalizeChromeHost lowercases and strips trailing dots', () => {
    expect(normalizeChromeHost('Example.COM.')).toBe('example.com')
  })

  test('TD is skip_all only under session bypass (env path in setup)', () => {
    // Without session bypass latch, default ask
    expect(chromePermissionModeFromSession()).toBe('ask')
  })

  test('four-arm: bypass → skip_all; host → follow_a_plan; domains → follow; else ask', () => {
    resetChromeInstallSessionState()
    const baseCtx = {
      mode: 'default' as const,
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      isBypassPermissionsModeAvailable: false,
    }
    const makeContext = (mode: string, extra: Record<string, unknown> = {}) =>
      ({
        getAppState: () => ({
          toolPermissionContext: { ...baseCtx, mode, ...extra },
        }),
      }) as any

    // arm: ask (no host, no domains)
    expect(
      resolveChromeCallPermissionOverrides(makeContext('default'), undefined)
        .permissionMode,
    ).toBe('ask')

    // arm: follow_a_plan with domains only
    const withDomain = makeContext('default', {
      alwaysAllowRules: { session: ['example.com'] },
    })
    const d = resolveChromeCallPermissionOverrides(withDomain, undefined)
    expect(d.permissionMode).toBe('follow_a_plan')
    expect(d.allowedDomains).toContain('example.com')
    expect(d.onPermissionRequest).toBeUndefined()

    // arm: host resolved → follow_a_plan + onPermissionRequest
    rememberResolvedChromeHost('tu-1', { host: 'docs.example.com' })
    const h = resolveChromeCallPermissionOverrides(
      makeContext('default'),
      'tu-1',
    )
    expect(h.permissionMode).toBe('follow_a_plan')
    expect(h.onPermissionRequest).toBeTypeOf('function')
    // consumed
    expect(
      getChromeInstallSessionState().resolvedHostByToolUseId.has('tu-1'),
    ).toBe(false)

    // arm: bypass
    const b = resolveChromeCallPermissionOverrides(
      makeContext('bypassPermissions'),
      undefined,
    )
    expect(b.permissionMode).toBe('skip_all_permission_checks')

    // gold kx==="bypassPermissions" — plan + listable bypass is NOT skip_all
    const planListed = resolveChromeCallPermissionOverrides(
      makeContext('plan', { isBypassPermissionsModeAvailable: true }),
      undefined,
    )
    expect(planListed.permissionMode).toBe('ask')
  })

  test('se rejects host not in allowed set', async () => {
    const allowed = new Set(['ok.example'])
    const se = createChromeOnPermissionRequest(allowed)
    await expect(se({ url: 'https://ok.example/path' } as any)).resolves.toBe(
      true,
    )
    await expect(se({ url: 'https://evil.test/' } as any)).resolves.toBe(false)
  })

  test('Pvr setChromeBinding stores context+socket; overrides export call', () => {
    const cleanup = readFileSync(
      join(import.meta.dir, '../tabGroupCleanup.ts'),
      'utf8',
    )
    expect(cleanup).toContain('bridgeBinding = { context, socketClient }')
    const render = readFileSync(
      join(import.meta.dir, '../toolRendering.tsx'),
      'utf8',
    )
    expect(render).toContain('resolveChromeCallPermissionOverrides')
    expect(render).toContain('handleToolCall')
    expect(render).toContain('async call(args, context')
    expect(render).toContain('prepareChromeFileUploadInput')
    expect(render).toContain('return { data: result.content }')
    const perm = readFileSync(
      join(import.meta.dir, '../chromeCallPermission.ts'),
      'utf8',
    )
    expect(perm).toContain('skip_all_permission_checks')
    expect(perm).toContain('follow_a_plan')
    expect(perm).toContain('kx(a,d)==="bypassPermissions"')
    expect(perm).not.toContain(
      "ctx.mode === 'plan' && ctx.isBypassPermissionsModeAvailable",
    )
  })

  test('chromeDomainSetsFromContext reads host-like allow rules', () => {
    const sets = chromeDomainSetsFromContext({
      mode: 'default',
      alwaysAllowRules: { session: ['foo.bar.com', 'not a host'] },
      alwaysDenyRules: {},
      isBypassPermissionsModeAvailable: false,
    } as any)
    expect(sets.allowed.has('foo.bar.com')).toBe(true)
    expect(sets.allowedRaw).toContain('foo.bar.com')
  })
})
