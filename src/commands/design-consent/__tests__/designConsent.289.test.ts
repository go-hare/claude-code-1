import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'

import designConsent from '../index.js'
import designRevoke from '../../design-revoke/index.js'
import designLogin from '../../design-login/index.js'

describe('gold 2.1.289 design-consent / design-revoke / design-login', () => {
  test('design-consent is hidden local FZt consent', () => {
    expect(designConsent.type).toBe('local')
    expect(designConsent.name).toBe('design-consent')
    expect(designConsent.isHidden).toBe(true)
    expect(designConsent.supportsNonInteractive).toBe(true)
    expect(designConsent.description).toBe(
      'Grant Claude agent access to your Design projects',
    )
  })

  test('design-revoke is hidden local FZt revoke', () => {
    expect(designRevoke.type).toBe('local')
    expect(designRevoke.name).toBe('design-revoke')
    expect(designRevoke.isHidden).toBe(true)
    expect(designRevoke.supportsNonInteractive).toBe(true)
    expect(designRevoke.description).toBe(
      'Revoke Claude agent access to your Design projects',
    )
  })

  test('design-login is local-jsx g8t and passes a manual code callback', () => {
    expect(designLogin.type).toBe('local-jsx')
    expect(designLogin.name).toBe('design-login')
    expect(designLogin.description).toContain('design-sync')
    expect(
      'supportsNonInteractive' in designLogin
        ? designLogin.supportsNonInteractive
        : undefined,
    ).toBeUndefined()
    const ui = readFileSync(
      new URL('../../design-login/designLogin.tsx', import.meta.url),
      'utf8',
    )
    expect(ui).toContain('onManualCode')
    expect(ui).toContain('skipBrowserOpen: isDesignLoginRemote()')
  })
})
