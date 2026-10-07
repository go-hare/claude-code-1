/**
 * densable 2.1.251 #22 — org policy disable quiet arm product-cut.
 * policyLimits deleted: init no longer QD-denies; state/UI quiet arm remains.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable 2.1.251 #22 policy_disabled quiet notice', () => {
  test('BridgeState includes policy_disabled', () => {
    const src = readFileSync(join(import.meta.dir, '../replBridge.ts'), 'utf8')
    expect(src).toContain("'policy_disabled'")
  })

  test('initReplBridge no longer QD-denies via policyLimits', () => {
    const src = readFileSync(
      join(import.meta.dir, '../initReplBridge.ts'),
      'utf8',
    )
    expect(src).not.toContain("getPolicyDenyKind('allow_remote_control')")
    expect(src).not.toContain("remoteControlPolicy === 'cache_miss'")
    expect(src).not.toContain("remoteControlPolicy === 'org_denied'")
    expect(src).not.toContain('waitForPolicyLimitsToLoad')
    expect(src).toContain('policy_disabled quiet arm')
  })

  test('useReplBridge handles policy_disabled as quiet notice branch', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../hooks/useReplBridge.tsx'),
      'utf8',
    )
    expect(src).toContain("state === 'policy_disabled'")
    expect(src).toContain(
      'Init declined by org policy; leaving Remote Control off',
    )
    expect(src).toContain('policyDisabledNotice')
    // quiet arm must not invent failure toast string
    expect(src).not.toContain("replBridgeError: 'check debug logs for details'")
  })

  test('managed disableRemoteControl still named in getBridgeDisabledReason', () => {
    const src = readFileSync(
      join(import.meta.dir, '../bridgeEnabled.ts'),
      'utf8',
    )
    expect(src).toContain(
      "Remote Control is disabled by your organization's policy (managed setting `disableRemoteControl`).",
    )
  })
})
