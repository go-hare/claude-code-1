/**
 * densable 2.1.247 #31 — hu/IP/Gd analytics off from startup.
 */
import { describe, expect, test } from 'bun:test'
import {
  isCustomOAuthAnalyticsOff,
  isManagedGatewayAnalyticsOff,
} from '../config.js'

describe('densable 2.1.247 #31 analytics off from startup', () => {
  test('IP: CLAUDE_CODE_CUSTOM_OAUTH_URL !== undefined', () => {
    expect(isCustomOAuthAnalyticsOff({})).toBe(false)
    expect(
      isCustomOAuthAnalyticsOff({ CLAUDE_CODE_CUSTOM_OAUTH_URL: '' }),
    ).toBe(true)
    expect(
      isCustomOAuthAnalyticsOff({
        CLAUDE_CODE_CUSTOM_OAUTH_URL: 'https://idp.example/oauth',
      }),
    ).toBe(true)
  })

  test('Gd: admin-managed forceLoginMethod gateway', () => {
    expect(isManagedGatewayAnalyticsOff('file', 'gateway')).toBe(true)
    expect(isManagedGatewayAnalyticsOff('hklm', 'gateway')).toBe(true)
    expect(isManagedGatewayAnalyticsOff('plist', 'gateway')).toBe(true)
    expect(isManagedGatewayAnalyticsOff('helper', 'gateway')).toBe(true)
    expect(isManagedGatewayAnalyticsOff('hkcu', 'gateway')).toBe(false)
    expect(isManagedGatewayAnalyticsOff('file', 'claudeai')).toBe(false)
    expect(isManagedGatewayAnalyticsOff(null, 'gateway')).toBe(false)
  })
})
