/**
 * Official isAskCappedByOrg UI gate: permanent-allow options must hide when
 * mcpInfo.effectiveMaxPermission === 'ask'. Pure mirrors for Fallback/WebFetch/Skill.
 */
import { describe, expect, test } from 'bun:test'

function showAlwaysAllow(opts: {
  baseAllowed: boolean
  effectiveMaxPermission?: 'allow' | 'ask' | 'blocked'
  hostname?: string
}): boolean {
  const isAskCappedByOrg = opts.effectiveMaxPermission === 'ask'
  if (opts.hostname !== undefined) {
    return opts.baseAllowed && !isAskCappedByOrg && opts.hostname !== ''
  }
  return opts.baseAllowed && !isAskCappedByOrg
}

describe('isAskCappedByOrg UI (2.1.x)', () => {
  test('ask ceiling hides always-allow', () => {
    expect(
      showAlwaysAllow({ baseAllowed: true, effectiveMaxPermission: 'ask' }),
    ).toBe(false)
  })

  test('allow ceiling keeps always-allow', () => {
    expect(
      showAlwaysAllow({ baseAllowed: true, effectiveMaxPermission: 'allow' }),
    ).toBe(true)
  })

  test('WebFetch also requires non-empty hostname', () => {
    expect(
      showAlwaysAllow({
        baseAllowed: true,
        effectiveMaxPermission: undefined,
        hostname: '',
      }),
    ).toBe(false)
    expect(
      showAlwaysAllow({
        baseAllowed: true,
        effectiveMaxPermission: undefined,
        hostname: 'api.example.com',
      }),
    ).toBe(true)
    expect(
      showAlwaysAllow({
        baseAllowed: true,
        effectiveMaxPermission: 'ask',
        hostname: 'api.example.com',
      }),
    ).toBe(false)
  })
})
