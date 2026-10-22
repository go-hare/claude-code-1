/**
 * densable 2.1.251 #22 — org policy disable is quiet (policy_disabled), not failed.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable 2.1.251 #22 policy_disabled quiet notice', () => {
  test('BridgeState includes policy_disabled', () => {
    const src = readFileSync(join(import.meta.dir, '../replBridge.ts'), 'utf8')
    expect(src).toContain("'policy_disabled'")
  })

  test('initReplBridge QD: cache_miss → failed; org_denied → policy_disabled', () => {
    const src = readFileSync(
      join(import.meta.dir, '../initReplBridge.ts'),
      'utf8',
    )
    expect(src).toContain("getPolicyDenyKind('allow_remote_control')")
    expect(src).toContain("remoteControlPolicy === 'cache_miss'")
    expect(src).toContain("'policy_unverified'")
    expect(src).toContain("onStateChange?.(\n      'failed'")
    expect(src).toContain("disabled by your organization's policy")
    expect(src).toContain("remoteControlPolicy === 'org_denied'")
    expect(src).toContain("onStateChange?.(\n      'policy_disabled'")
    expect(src).toContain(
      "Remote Control is disabled by your organization's policy. Contact your organization admin for access.",
    )
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
