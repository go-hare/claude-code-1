import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { f6e, gP } from '../../bg.js'

describe('handleBgStart leftover engine (251 #41)', () => {
  test('So leftover env spreads urr(awn())', () => {
    const src = readFileSync(join(import.meta.dir, '../../bg.ts'), 'utf8')
    expect(src).toContain('getDispatcherAccountFromOauthToken')
    expect(src).toContain('dispatcherReattachEnv')
    expect(src).toContain(
      'dispatcherReattachEnv(getDispatcherAccountFromOauthToken())',
    )
    expect(src).toContain('...process.env')
  })

  test('f6e is false without requestDialog (G5/Xpe ABSENT)', () => {
    expect(f6e(undefined)).toBe(false)
    expect(f6e(null)).toBe(false)
    expect(f6e({})).toBe(false)
    expect(f6e(async () => 'consent')).toBe(true)
    const src = readFileSync(join(import.meta.dir, '../../bg.ts'), 'utf8')
    expect(src).toContain('if (requestDialog == null) return false')
    expect(src).not.toContain('G5(')
    expect(src).not.toContain('Xpe(')
  })

  test('gP is false on --bg: no requestDialog, no prompt, no abort', () => {
    expect(gP(undefined, undefined)).toBe(false)
    expect(gP('fable', undefined)).toBe(false)
    expect(gP('fable', null)).toBe(false)
    expect(gP('fable', async () => 'consent')).toBe(true)
    const src = readFileSync(join(import.meta.dir, '../../bg.ts'), 'utf8')
    expect(src).toContain('void gP(undefined, undefined)')
    expect(src).toContain('no fable_overage_consent_prompt, no abort')
  })
})
