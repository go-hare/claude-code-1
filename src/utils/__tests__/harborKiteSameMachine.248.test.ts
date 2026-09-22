/**
 * densable 2.1.248 #7 — Po() same-machine SendMessage/ListAgents gate.
 * SEA @180993160 sha=2458d5c4fc055ea1:
 *   function Po(){let e=a.CLAUDE_CODE_HARBOR_KITE;if(e!==void 0)return Me(e);
 *   if(B()==="windows"&&!R("tengu_harbor_kite_win",!0))return!1;
 *   return R("tengu_harbor_kite",!0)}
 * Ye() / cloudHop stay firstParty leftover — not this bullet.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { isHarborKiteEnabled } from '../teleport/cloudPeerAccess.js'

const ENV_KEY = 'CLAUDE_CODE_HARBOR_KITE'
const savedHarbor = process.env[ENV_KEY]

const peerSrc = readFileSync(
  join(import.meta.dir, '../teleport/cloudPeerAccess.ts'),
  'utf8',
)
const configSrc = readFileSync(
  join(import.meta.dir, '../../components/Settings/Config.tsx'),
  'utf8',
)
const setupSrc = readFileSync(join(import.meta.dir, '../../setup.ts'), 'utf8')
const cloudHopSrc = readFileSync(
  join(
    import.meta.dir,
    '../../../packages/builtin-tools/src/tools/SendMessageTool/cloudHop.ts',
  ),
  'utf8',
)

function poBody(src: string, marker: string): string {
  const start = src.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const brace = src.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(brace, i + 1)
    }
  }
  return src.slice(start, start + 280)
}

afterEach(() => {
  if (savedHarbor === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = savedHarbor
  }
})

describe('densable 2.1.248 #7 Po same-machine harbor kite', () => {
  test('Po leftover copies use gold env-defined Me + GB default true', () => {
    for (const body of [
      poBody(peerSrc, 'export function isHarborKiteEnabled'),
      poBody(configSrc, 'function isCrossSessionInboxConfigRowVisible'),
    ]) {
      expect(body).toContain('CLAUDE_CODE_HARBOR_KITE')
      expect(body).toContain('e !== undefined')
      expect(body).toContain('isEnvTruthy(e)')
      expect(body).toContain(
        "getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite_win', true)",
      )
      expect(body).toContain(
        "getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite', true)",
      )
      expect(body).not.toContain(
        "getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite_win', false)",
      )
      expect(body).not.toContain(
        "getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_kite', false)",
      )
      expect(body).not.toContain('firstParty')
      expect(body).not.toContain('isEssentialTrafficOnly')
      expect(body).not.toContain('UDS_INBOX')
      expect(body).not.toContain('tengu_harbor_kite_cloud')
    }
  })

  test('UDS leftover skip string is the Po gate-off leftover', () => {
    expect(setupSrc).toContain(
      '[uds-messaging] Skipped: cross-session messaging gate off',
    )
    expect(setupSrc).toContain('isHarborKiteEnabled()')
    expect(setupSrc).not.toContain(
      'will late-bind if a GrowthBook refresh enables it',
    )
    expect(setupSrc).not.toContain(
      '[uds-messaging] Skipped: remote thin client',
    )
  })

  test('Ye / cloudHop leftover stays firstParty — not folded into Po', () => {
    expect(cloudHopSrc).toContain("getAPIProvider() === 'firstParty'")
    expect(cloudHopSrc).toContain('isEssentialTrafficOnly()')
    expect(peerSrc).toContain("getAPIProvider() !== 'firstParty'")
    const po = poBody(peerSrc, 'export function isHarborKiteEnabled')
    expect(po).not.toContain('getAPIProvider')
  })

  test('defined env is Me() — explicit off wins over GB default ON', () => {
    process.env[ENV_KEY] = '0'
    expect(isHarborKiteEnabled()).toBe(false)
    process.env[ENV_KEY] = 'false'
    expect(isHarborKiteEnabled()).toBe(false)
    process.env[ENV_KEY] = '1'
    expect(isHarborKiteEnabled()).toBe(true)
    process.env[ENV_KEY] = 'true'
    expect(isHarborKiteEnabled()).toBe(true)
  })

  test('unset env uses gold GB default ON (windows win-gate default true)', () => {
    delete process.env[ENV_KEY]
    expect(isHarborKiteEnabled()).toBe(true)
  })
})
