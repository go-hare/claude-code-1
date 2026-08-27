/**
 * densable 236 #11 — Q2m / J2m / claimForStandaloneRender surface negotiation.
 *
 * No mock.module on bootstrap/state or utils that pull settings (pollution).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getIsInteractive, setIsInteractive } from '../../../bootstrap/state.js'
import instances, {
  resetEverMountedForTests,
} from '../../../../packages/@ant/ink/src/core/instances.js'
import {
  getManagedSettingsConsentRegistry,
  installManagedSettingsRequester,
  resetManagedSettingsConsentRegistryForTests,
  waitForManagedSettingsRequester,
} from '../consentRequester.js'
import {
  checkManagedSettingsSecurity,
  handleSecurityCheckResult,
} from '../securityCheck.js'

const dangerousSettings = {
  env: { ANTHROPIC_API_KEY: 'sk-test' },
  hooks: { PreToolUse: [{ matcher: '*', hooks: [] }] },
} as never

let prevInteractive: boolean

beforeEach(() => {
  prevInteractive = getIsInteractive()
  setIsInteractive(true)
})

afterEach(() => {
  resetManagedSettingsConsentRegistryForTests()
  resetEverMountedForTests()
  instances.clear()
  setIsInteractive(prevInteractive)
})

describe('densable J2m / Cqw consent requester', () => {
  test('registerRequester drains waiters', async () => {
    const waiter = Promise.race([
      waitForManagedSettingsRequester(),
      new Promise<null>(resolve => {
        setTimeout(() => resolve(null), 50)
      }),
    ])
    const dispose = installManagedSettingsRequester(async () => 'approved')
    const got = await waiter
    expect(got).not.toBeNull()
    dispose()
  })

  test('review supersede resolves first with superseded', async () => {
    const reg = getManagedSettingsConsentRegistry()
    let resolveDialog!: (r: 'approved' | 'rejected') => void
    const dispose = installManagedSettingsRequester((_settings, _updates) => {
      return new Promise(resolve => {
        resolveDialog = resolve
      })
    })
    const first = reg.review(reg.replRequester!, { env: { A: '1' } })
    const second = reg.review(reg.replRequester!, { env: { A: '2' } })
    expect(await first).toBe('superseded')
    resolveDialog('approved')
    expect(await second).toBe('approved')
    dispose()
  })
})

describe('densable $yf claimForStandaloneRender', () => {
  test('claim clears pendingStandaloneRender when promise settles', async () => {
    let resolve!: () => void
    const p = new Promise<void>(r => {
      resolve = r
    })
    instances.claimForStandaloneRender(p)
    expect(instances.pendingStandaloneRender).not.toBeNull()
    resolve()
    await instances.pendingStandaloneRender
    expect(instances.pendingStandaloneRender).toBeNull()
  })

  test('set marks everMounted', () => {
    expect(instances.everMounted).toBe(false)
    instances.set(process.stdout, {} as never)
    expect(instances.everMounted).toBe(true)
    instances.delete(process.stdout)
  })
})

describe('densable Q2m early branches via checkManagedSettingsSecurity', () => {
  test('requester path preferred over showSecurityDialog', async () => {
    const dispose = installManagedSettingsRequester(async () => 'approved')
    let standaloneCalls = 0
    const result = await checkManagedSettingsSecurity(
      null,
      dangerousSettings,
      null,
      async () => {
        standaloneCalls++
        return 'rejected'
      },
    )
    expect(result).toBe('approved')
    expect(standaloneCalls).toBe(0)
    dispose()
  })

  test('Yp.has(stdout) waits for requester then reviews', async () => {
    instances.set(process.stdout, {} as never)
    const checkPromise = checkManagedSettingsSecurity(
      null,
      dangerousSettings,
      null,
      async () => 'rejected',
    )
    await Promise.resolve()
    const dispose = installManagedSettingsRequester(async () => 'approved')
    expect(await checkPromise).toBe('approved')
    dispose()
  })

  test('handleSecurityCheckResult: superseded → false', () => {
    expect(handleSecurityCheckResult('superseded')).toBe(false)
    expect(handleSecurityCheckResult('deferred_no_consent_surface')).toBe(false)
    expect(handleSecurityCheckResult('deferred_non_interactive')).toBe(true)
  })
})
