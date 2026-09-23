import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isNonFirstPartyAnalyticsOff } from '../config.js'

describe('analytics gateway auth gate (2.1.251 #62)', () => {
  test('Kh uses gatewayAuth and not forceLoginMethod', () => {
    const src = readFileSync(join(import.meta.dir, '../config.ts'), 'utf8')
    const start = src.indexOf('export function isAnalyticsDisabled')
    const end = src.indexOf('export function isFeedbackSurveyDisabled')
    const body = src.slice(start, end)
    expect(body).toContain('getGatewayAuth')
    expect(body).not.toContain('isManagedGatewayAnalyticsOff')
    expect(body).not.toContain('forceLoginMethod')
    expect(body).toContain('isNonFirstPartyAnalyticsOff')
    expect(body).not.toContain("NODE_ENV === 'test'")
  })

  test('Zq is !firstParty unless the host flag; firstParty stays on', () => {
    const src = readFileSync(join(import.meta.dir, '../config.ts'), 'utf8')
    const start = src.indexOf('export function isNonFirstPartyAnalyticsOff')
    const end = src.indexOf('export function isAnalyticsDisabled')
    const body = src.slice(start, end)
    expect(body).toContain("getAPIProvider() !== 'firstParty'")
    expect(body).toContain('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST')
    expect(body).not.toContain('CLAUDE_CODE_USE_BEDROCK')
    expect(body).not.toContain('CLAUDE_CODE_USE_VERTEX')
    expect(body).not.toContain('CLAUDE_CODE_USE_FOUNDRY')
    expect(
      isNonFirstPartyAnalyticsOff({
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      }),
    ).toBe(false)
  })
})
