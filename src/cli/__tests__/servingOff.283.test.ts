/**
 * densable 2.1.283 leftover gold `fs` @202325188 wrap.
 *
 * Gold SEA `/tmp/official-283/package/claude` — chain only; no engines.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { servingOffReason } from '../servingOff.js'

const src = (rel: string) => readFileSync(join(import.meta.dir, rel), 'utf8')

describe('servingOff 283 leftover gold fs wrap', () => {
  test('source-locks gold fs chain; no ps copy; no cloudSession edit', () => {
    const body = src('../servingOff.ts')
    expect(body).toContain('gold `fs` @202325188')
    expect(body).toContain('primeWindowsProfileDirs')
    expect(body).toContain('remoteToolServingOffReason')
    expect(body).toContain('servedToolsUnavailableReason')
    expect(body).toContain('isViolinWoodServedOff')
    expect(body).toContain("? 'flag_off'")
    expect(body).toContain('!isViolinWoodEnabledSync()')
    expect(body).toContain('checkLocalServeIdentity')
    expect(body).not.toContain('export function fs')
    expect(body).not.toContain('this Claude Code cannot serve tools')
    expect(body).not.toContain('tengu_violin_amati')
    expect(body).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
  })

  test('wood-off → flag_off', async () => {
    expect(await servingOffReason({ isViolinWoodServedOff: () => true })).toBe(
      'flag_off',
    )
  })

  test('wood-on + no engines → undefined', async () => {
    expect(
      await servingOffReason({ isViolinWoodServedOff: () => false }),
    ).toBeUndefined()
  })

  test('injected remoteToolServingOffReason wins over wood-off', async () => {
    expect(
      await servingOffReason({
        remoteToolServingOffReason: () => 'windows',
        servedToolsUnavailableReason: () => 'muted',
        isViolinWoodServedOff: () => true,
      }),
    ).toBe('windows')
  })

  test('servedToolsUnavailableReason wins when remote is undefined', async () => {
    expect(
      await servingOffReason({
        servedToolsUnavailableReason: () => 'switch_off',
        isViolinWoodServedOff: () => true,
      }),
    ).toBe('switch_off')
  })

  test('primes Windows profile dirs before reading reasons', async () => {
    const order: string[] = []
    await servingOffReason({
      primeWindowsProfileDirs: async () => {
        order.push('prime')
      },
      remoteToolServingOffReason: () => {
        order.push('remote')
        return 'profile_dirs_unread'
      },
      servedToolsUnavailableReason: () => {
        order.push('served')
        return 'muted'
      },
      isViolinWoodServedOff: () => {
        order.push('wood')
        return true
      },
    })
    expect(order[0]).toBe('prime')
    expect(order).toContain('remote')
  })
})
