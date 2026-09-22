/**
 * densable 2.1.248 #25 login-gateway-hang — DKt / pOe / CHn / ee / X reveal.
 * leftover Select is not rewritten (no reveal prop on Select).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { getIsInteractive, setIsInteractive } from '../../../bootstrap/state.js'
import { managedSettingsSecurityUpdates } from '../../../dialog/specs/managedSettingsSecurity.js'
import {
  LOGIN_HANDOFF_WINDOW_MS,
  REFUSE_WITHIN_DEFAULT_MS,
  isWithinRefuseWindow,
} from '../../../hooks/useRefuseWithin.js'
import type { SettingsJson } from '../../../utils/settings/types.js'
import { Stream } from '../../../utils/stream.js'
import {
  getManagedSettingsConsentRegistry,
  holdConsentHandoff,
  installManagedSettingsRequester,
  isConsentHandoffHeld,
  isConsentHandoffRevealActive,
  registerConsentNeededRelease,
  resetManagedSettingsConsentRegistryForTests,
  subscribeConsentHandoff,
  yieldConsentMacrotask,
} from '../consentRequester.js'
import { checkManagedSettingsSecurity } from '../securityCheck.js'

const dialogSrc = readFileSync(
  join(
    import.meta.dir,
    '../../../components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.tsx',
  ),
  'utf8',
)
const selectSrc = readFileSync(
  join(import.meta.dir, '../../../components/CustomSelect/select.tsx'),
  'utf8',
)
const specSrc = readFileSync(
  join(import.meta.dir, '../../../dialog/specs/managedSettingsSecurity.ts'),
  'utf8',
)
const loginSrc = readFileSync(
  join(import.meta.dir, '../../../commands/login/login.tsx'),
  'utf8',
)
const standaloneSrc = readFileSync(
  join(import.meta.dir, '../securityCheck.tsx'),
  'utf8',
)

const dangerousSettings = {
  env: { ANTHROPIC_API_KEY: 'sk-test' },
  hooks: { PreToolUse: [{ matcher: '*', hooks: [] }] },
} as SettingsJson

let prevInteractive: boolean

beforeEach(() => {
  prevInteractive = getIsInteractive()
  setIsInteractive(true)
})

afterEach(() => {
  resetManagedSettingsConsentRegistryForTests()
  setIsInteractive(prevInteractive)
})

describe('densable 2.1.248 #25 login-gateway-hang', () => {
  test('pOe yields login_handoff when DKt', async () => {
    const reg = getManagedSettingsConsentRegistry()
    reg.consentHandoffRevealActive = true
    const updates = new Stream<SettingsJson>()
    const gen = managedSettingsSecurityUpdates({ env: { A: '1' } }, updates)
    const first = await gen.next()
    expect(first.value).toEqual({
      settings: { env: { A: '1' } },
      reveal: 'login_handoff',
    })
    updates.done()
    await gen.next()
  })

  test('pOe starts default and upgrades mid-stream when DKt flips', async () => {
    const updates = new Stream<SettingsJson>()
    const gen = managedSettingsSecurityUpdates({ env: { A: '1' } }, updates)
    const first = await gen.next()
    expect(first.value?.reveal).toBe('default')
    getManagedSettingsConsentRegistry().consentHandoffRevealActive = true
    updates.enqueue({ env: { A: '2' } })
    const second = await gen.next()
    expect(second.value).toEqual({
      settings: { env: { A: '2' } },
      reveal: 'login_handoff',
    })
    updates.done()
    await gen.next()
  })

  test('pOe stays login_handoff once upgraded', async () => {
    const reg = getManagedSettingsConsentRegistry()
    reg.consentHandoffRevealActive = true
    const updates = new Stream<SettingsJson>()
    const gen = managedSettingsSecurityUpdates({ env: { A: '1' } }, updates)
    await gen.next()
    reg.consentHandoffRevealActive = false
    updates.enqueue({ env: { A: '2' } })
    const second = await gen.next()
    expect(second.value?.reveal).toBe('login_handoff')
    updates.done()
    await gen.next()
  })

  test('ee CHn branch sets DKt during review and clears after', async () => {
    const reg = getManagedSettingsConsentRegistry()
    let sawReveal = false
    let callbackFired = false
    const disposeRequester = installManagedSettingsRequester(async () => {
      sawReveal = isConsentHandoffRevealActive()
      return 'approved'
    })
    const disposeCHn = registerConsentNeededRelease(() => {
      callbackFired = true
    })
    const result = await checkManagedSettingsSecurity(
      null,
      dangerousSettings,
      null,
    )
    expect(result).toBe('approved')
    expect(callbackFired).toBe(true)
    expect(sawReveal).toBe(true)
    expect(isConsentHandoffRevealActive()).toBe(false)
    expect(isConsentHandoffHeld()).toBe(false)
    disposeCHn()
    disposeRequester()
  })

  test('ee without CHn reviews with DKt false', async () => {
    const disposeRequester = installManagedSettingsRequester(async () => {
      expect(isConsentHandoffRevealActive()).toBe(false)
      return 'rejected'
    })
    const result = await checkManagedSettingsSecurity(
      null,
      dangerousSettings,
      null,
    )
    expect(result).toBe('rejected')
    disposeRequester()
  })

  test('PKt hold emits and Ixt tracks size', () => {
    let emits = 0
    const unsub = subscribeConsentHandoff(() => {
      emits += 1
    })
    expect(isConsentHandoffHeld()).toBe(false)
    const release = holdConsentHandoff()
    expect(isConsentHandoffHeld()).toBe(true)
    expect(emits).toBe(1)
    release()
    expect(isConsentHandoffHeld()).toBe(false)
    expect(emits).toBe(2)
    unsub()
  })

  test('ed refuse window is [0, Ky)', () => {
    const now = Date.now()
    expect(isWithinRefuseWindow(now, REFUSE_WITHIN_DEFAULT_MS)).toBe(true)
    expect(
      isWithinRefuseWindow(
        now - REFUSE_WITHIN_DEFAULT_MS,
        REFUSE_WITHIN_DEFAULT_MS,
      ),
    ).toBe(false)
    expect(LOGIN_HANDOFF_WINDOW_MS).toBe(250)
    expect(REFUSE_WITHIN_DEFAULT_MS).toBe(150)
  })

  test('yieldConsentMacrotask resolves (densable zI)', async () => {
    await yieldConsentMacrotask()
  })

  test('X dialog accepts reveal and official d() / hn mapping', () => {
    expect(dialogSrc).toContain("reveal === 'login_handoff'")
    expect(dialogSrc).toContain('hideIndexes={loginHandoff}')
    expect(dialogSrc).toContain(
      "defaultFocusValue={loginHandoff ? 'exit' : 'accept'}",
    )
    expect(dialogSrc).toContain('No, exit Claude Code')
    expect(dialogSrc).toContain('Yes, I trust these settings')
    expect(dialogSrc).toContain('Managed settings require approval')
    expect(dialogSrc).toContain('if (!loginHandoff)')
    expect(dialogSrc).toContain(
      'justMounted() || refusedWithin(LOGIN_HANDOFF_WINDOW_MS)',
    )
    expect(dialogSrc).toContain('reveal?: ManagedSettingsReveal')
  })

  test('leftover Select is not rewritten with reveal', () => {
    expect(selectSrc).not.toContain('login_handoff')
    expect(selectSrc).not.toContain('reveal')
    expect(selectSrc).toContain('readonly hideIndexes?: boolean')
  })

  test('s_A / nie spec carries official reveal enum', () => {
    expect(specSrc).toContain("z.enum(['login_handoff', 'default'])")
    expect(specSrc).toContain('isConsentHandoffRevealActive()')
    expect(specSrc).toContain("reveal !== 'login_handoff'")
  })

  test('standalone qEt passes reveal default + accepts/ed', () => {
    expect(standaloneSrc).toContain('reveal="default"')
    expect(standaloneSrc).toContain('accepts={accepts}')
    expect(standaloneSrc).toContain('isWithinRefuseWindow(mountedAt)')
    expect(standaloneSrc).toContain('consentNeededRelease')
    expect(standaloneSrc).toContain('consentHandoffRevealActive = true')
  })

  test('login gateway wires official CHn / lnr / zI', () => {
    expect(loginSrc).toContain(
      "Signed in. Review your organization's managed settings to continue.",
    )
    expect(loginSrc).toContain('registerConsentNeededRelease')
    expect(loginSrc).toContain('holdConsentHandoff()')
    expect(loginSrc).toContain('yieldConsentMacrotask()')
    expect(loginSrc).toContain("display: 'system'")
    expect(loginSrc).toContain('await refreshRemoteManagedSettings()')
    expect(loginSrc).toContain("getClientType() === 'gateway'")
  })
})
