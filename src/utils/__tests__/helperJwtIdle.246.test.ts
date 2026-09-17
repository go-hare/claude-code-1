/**
 * densable 2.1.246 HAVE #45 — idle apiKeyHelper short JWT refresh.
 *
 * Official IR @207118128: !QK(cache)&&ie()&&Hs()&&!dr() force refresh.
 *   DR @207117578 → CLAUDE_CODE_API_KEY_HELPER_TTL_MS or UK=300000
 *   bR=30000
 *   Hs @207113934 = !uo() && source==="apiKeyHelper" (skip execute)
 *   dr @207113039 = ANTHROPIC_AUTH_TOKEN unless ga()
 *   QK @207117866 → na(e.value)
 *   na = W as cwc @205293986 — decodeJwtExpiry (sk-ant-si- + 3-part + exp)
 *   ie = X as eCc @206041396 — d()==="firstParty"
 *
 * Local: TTL+SWR + 401 clear + QK/na/ie/Hs/dr force-refresh.
 * jwtUtils.decodeJwtExpiry re-exports official W. gatewayEnv.decodeJwtExpSeconds
 * is NOT na.
 *
 * HAVE 2026-09-15b.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  API_KEY_HELPER_JWT_REFRESH_BUFFER_MS,
  isApiKeyHelperJwtCacheValid,
} from '../auth.js'

const srcRoot = join(import.meta.dir, '../..')
const auth = readFileSync(join(srcRoot, 'utils/auth.ts'), 'utf8')
const gateway = readFileSync(join(srcRoot, 'utils/gatewayEnv.ts'), 'utf8')
const ttl = readFileSync(join(srcRoot, 'utils/residualMsEnvGates.ts'), 'utf8')

function unsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString(
    'base64url',
  )
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

describe('HAVE #45 helper JWT idle (2.1.246)', () => {
  test('helper cache is TTL+SWR plus official QK/na/ie force refresh', () => {
    expect(auth).toContain('calculateApiKeyHelperTTL')
    expect(auth).toContain('clearApiKeyHelperCache')
    expect(auth).toContain('SWR')
    expect(ttl).toContain('DEFAULT_API_KEY_HELPER_TTL_MS = 5 * 60 * 1000')
    expect(auth).toContain('decodeJwtExpiry')
    expect(auth).toContain('API_KEY_HELPER_JWT_REFRESH_BUFFER_MS = 30_000')
    expect(auth).toContain("getAPIProvider() !== 'firstParty'")
    expect(auth).toContain("source !== 'apiKeyHelper'")
    expect(auth).toContain('isRunningOnHomespace()')
    expect(auth).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(auth).not.toContain('decodeJwtExpSeconds')
    expect(gateway).toContain('export function decodeJwtExpSeconds(')
    expect(gateway).not.toContain('apiKeyHelper')
    const jwtExpiry = readFileSync(join(srcRoot, 'utils/jwtExpiry.ts'), 'utf8')
    expect(jwtExpiry).toContain("token.startsWith('sk-ant-si-')")
    expect(jwtExpiry).toContain('parts.length !== 3 || !parts[1]')
    expect(jwtExpiry).toContain('export function decodeJwtExpiry(')
    const jwtUtils = readFileSync(join(srcRoot, 'bridge/jwtUtils.ts'), 'utf8')
    expect(jwtUtils).toContain('export { decodeJwtExpiry, decodeJwtPayload }')
    const gold = readFileSync(
      join(
        srcRoot,
        '../docs/upstream-extraction/v2.1.246/snippets/gold-bytecode-na-ie-he-bln.txt',
      ),
      'utf8',
    )
    expect(gold).toContain('W as cwc')
    expect(gold).toContain('function X(){return d()==="firstParty"}')
    expect(gold).toContain('function t9s(){return eQe?.().foreign===!0}')
    expect(gold).toContain('async function Vl(r,a){')
  })

  test('QK: no exp stays valid; near-expiry forces refresh', () => {
    expect(API_KEY_HELPER_JWT_REFRESH_BUFFER_MS).toBe(30_000)
    const now = Date.now()
    expect(
      isApiKeyHelperJwtCacheValid({ value: 'not-a-jwt', timestamp: now }),
    ).toBe(true)
    const far = unsignedJwt({ exp: Math.floor(now / 1000) + 3600 })
    expect(isApiKeyHelperJwtCacheValid({ value: far, timestamp: now })).toBe(
      true,
    )
    const nearExp = Math.floor(now / 1000) + 10
    const near = unsignedJwt({ exp: nearExp })
    const prefixed = `sk-ant-si-${near}`
    const cachedBeforeWindow = now - 60_000
    expect(
      isApiKeyHelperJwtCacheValid({
        value: near,
        timestamp: cachedBeforeWindow,
      }),
    ).toBe(false)
    expect(
      isApiKeyHelperJwtCacheValid({
        value: prefixed,
        timestamp: cachedBeforeWindow,
      }),
    ).toBe(false)
    expect(
      isApiKeyHelperJwtCacheValid({
        value: near,
        timestamp: nearExp * 1000 - 1_000,
      }),
    ).toBe(true)
  })
})
