import { describe, expect, test } from 'bun:test'

import { isBuiltinWeixinChannel } from '../channelAllowlist.js'
import {
  evaluateChannelAllowlistSkip,
  gateChannelServer,
  isChannelGateHardRevocation,
  isChannelsPolicyBlocked,
} from '../channelNotification.js'

describe('isChannelGateHardRevocation', () => {
  test('gold t2a: provider/disabled/capability/era tear down', () => {
    expect(isChannelGateHardRevocation('provider')).toBe(true)
    expect(isChannelGateHardRevocation('disabled')).toBe(true)
    expect(isChannelGateHardRevocation('capability')).toBe(true)
    expect(isChannelGateHardRevocation('era')).toBe(true)
  })

  test('soft skips preserve a previously registered handler', () => {
    expect(isChannelGateHardRevocation('policy')).toBe(false)
    expect(isChannelGateHardRevocation('session')).toBe(false)
    expect(isChannelGateHardRevocation('marketplace')).toBe(false)
    expect(isChannelGateHardRevocation('allowlist')).toBe(false)
    expect(isChannelGateHardRevocation('auth')).toBe(false)
  })
})

describe('isChannelsPolicyBlocked', () => {
  test('team/enterprise require channelsEnabled: true', () => {
    expect(isChannelsPolicyBlocked(null, 'team')).toBe(true)
    expect(
      isChannelsPolicyBlocked({ channelsEnabled: false }, 'enterprise'),
    ).toBe(true)
    expect(isChannelsPolicyBlocked({ channelsEnabled: true }, 'team')).toBe(
      false,
    )
  })

  test('does not port gold non-Yi residual (policy file without opt-in)', () => {
    expect(isChannelsPolicyBlocked({ channelsEnabled: false }, 'pro')).toBe(
      false,
    )
    expect(isChannelsPolicyBlocked({ channelsEnabled: false }, null)).toBe(
      false,
    )
  })
})

describe('evaluateChannelAllowlistSkip', () => {
  test('dev entries bypass allowlist', () => {
    expect(
      evaluateChannelAllowlistSkip(
        { kind: 'server', name: 'local-tg', dev: true },
        undefined,
        null,
        null,
      ),
    ).toBeNull()
  })

  test('server-kind without dev is allowlist skip', () => {
    const skip = evaluateChannelAllowlistSkip(
      { kind: 'server', name: 'local-tg' },
      undefined,
      null,
      null,
    )
    expect(skip?.kind).toBe('allowlist')
    expect(skip?.reason).toContain(
      'use --dangerously-load-development-channels for local dev',
    )
  })

  test('org list replaces ledger for team and names the org reason', () => {
    const skip = evaluateChannelAllowlistSkip(
      { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
      'slack@anthropic',
      {
        allowedChannelPlugins: [
          { plugin: 'telegram', marketplace: 'anthropic' },
        ],
      },
      'team',
    )
    expect(skip?.kind).toBe('allowlist')
    expect(skip?.reason).toContain("org's approved channels list")
  })

  test('org-listed plugin is admitted', () => {
    expect(
      evaluateChannelAllowlistSkip(
        { kind: 'plugin', name: 'slack', marketplace: 'anthropic' },
        'slack@anthropic',
        {
          allowedChannelPlugins: [
            { plugin: 'slack', marketplace: 'anthropic' },
          ],
        },
        'enterprise',
      ),
    ).toBeNull()
  })

  test('builtin weixin is always admitted', () => {
    expect(isBuiltinWeixinChannel('weixin@builtin')).toBe(true)
    expect(
      evaluateChannelAllowlistSkip(
        { kind: 'plugin', name: 'weixin', marketplace: 'builtin' },
        'weixin@builtin',
        null,
        null,
      ),
    ).toBeNull()
  })
})

describe('gateChannelServer early i3r skips', () => {
  test('capability miss before era/provider', () => {
    const gate = gateChannelServer('plugin:slack:tg', undefined, undefined)
    expect(gate).toEqual({
      action: 'skip',
      kind: 'capability',
      reason: 'server did not declare claude/channel capability',
    })
  })

  test('explicit false capability is opt-out', () => {
    const gate = gateChannelServer(
      'plugin:slack:tg',
      { experimental: { 'claude/channel': false } },
      undefined,
    )
    expect(gate.action).toBe('skip')
    if (gate.action === 'skip') expect(gate.kind).toBe('capability')
  })

  test('modern protocolEra skips before provider', () => {
    const gate = gateChannelServer(
      'plugin:slack:tg',
      { experimental: { 'claude/channel': {} } },
      undefined,
      'modern',
    )
    expect(gate).toEqual({
      action: 'skip',
      kind: 'era',
      reason:
        'connection negotiated a modern protocol revision with no unsolicited notification path',
    })
  })
})
