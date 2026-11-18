import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../../..')

describe('v2.1.292 #207 NO_PROXY url wiring in client.ts and anthropicOidc.ts', () => {
  test('client.ts passes target url to getProxyFetchOptions', () => {
    const src = readFileSync(join(ROOT, 'src/services/api/client.ts'), 'utf8')
    expect(src).toContain('getClientTargetUrl(requestProvider, model)')
    expect(src).toContain('url: getClientTargetUrl(requestProvider, model)')
  })

  test('anthropicOidc.ts passes request url to getProxyFetchOptions', () => {
    const src = readFileSync(join(ROOT, 'src/utils/anthropicOidc.ts'), 'utf8')
    expect(src).toContain('getProxyFetchOptions({')
    expect(src).toContain('url: urlStr')
  })
})

describe('v2.1.295 #358 context-1m beta retry wiring in claude.ts', () => {
  test('claude.ts wires decideContext1mBetaRetry and tengu_beta_400_healed on success', () => {
    const src = readFileSync(join(ROOT, 'src/services/api/claude.ts'), 'utf8')
    expect(src).toContain('decideContext1mBetaRetry({')
    expect(src).toContain("return 'retry:context-1m-beta'")
    expect(src).toContain('context1mBetaRetryPhase')
    expect(src).toContain("logEvent('tengu_beta_400_healed'")
  })
})
