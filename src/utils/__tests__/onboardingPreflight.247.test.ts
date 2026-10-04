/**
 * densable 2.1.247 #22 — skip first-run Anthropic preflight when managed
 * settings force gateway sign-in (Q$) or admin policy load errors exist (Z$).
 *
 * Product-cut: MDM is gone. Z$ only reads managed-file errors (always empty).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('onboarding preflight skip 247 #22', () => {
  const forceSrc = readFileSync(
    join(import.meta.dir, '../forceLoginMethod.ts'),
    'utf8',
  )
  const onboarding = readFileSync(
    join(import.meta.dir, '../../components/Onboarding.tsx'),
    'utf8',
  )

  test('Q$ requires admin origin then gateway method or URL-without-method', () => {
    expect(forceSrc).toContain('export function isManagedSettingsGatewaySignIn')
    expect(forceSrc).toContain(
      'isAdminManagedPolicyOrigin(getPolicySettingsOrigin())',
    )
    expect(forceSrc).toContain("getSettingsForSource('policySettings')")
    expect(forceSrc).toContain("policy?.forceLoginMethod === 'gateway'")
    expect(forceSrc).toContain('policy?.forceLoginGatewayUrl !== undefined')
    expect(forceSrc).toContain('policy?.forceLoginMethod === undefined')
  })

  test('Z$ is non-warning admin load errors (managed file stub, not MDM/hkcu)', () => {
    expect(forceSrc).toContain(
      'export function hasNonWarningAdminPolicyLoadErrors',
    )
    expect(forceSrc).toContain('filterNonWarningPolicyLoadErrors')
    expect(forceSrc).toContain("e.severity !== 'warning'")
    expect(forceSrc).toContain('loadManagedFileSettings().errors')
    expect(forceSrc).not.toContain('getMdmSettings()')
    expect(forceSrc).not.toContain('getHkcuSettings()')
  })

  test('ri drops severity === warning; missing severity still counts', async () => {
    const { filterNonWarningPolicyLoadErrors } = await import(
      '../forceLoginMethod.js'
    )
    expect(
      filterNonWarningPolicyLoadErrors([
        { message: 'alias', severity: 'warning' },
        { message: 'fatal', severity: 'fatal' },
        { message: 'plain' },
      ]).map(e => e.message),
    ).toEqual(['fatal', 'plain'])
  })

  test('Onboarding l = Q$()||Z$(); preflight only when oauth && !l', () => {
    expect(onboarding).toContain('shouldSkipOnboardingPreflight()')
    expect(onboarding).toContain('oauthEnabled && !skipAnthropicPreflight')
    expect(onboarding).toContain("id: 'preflight'")
    expect(onboarding).toContain('<PreflightStep onSuccess={goToNextStep} />')
    expect(onboarding).not.toContain('_preflightStep')
    expect(onboarding.indexOf("id: 'preflight'")).toBeLessThan(
      onboarding.indexOf("id: 'theme'"),
    )
  })
})
