import { describe, expect, test } from 'bun:test'
import {
  filterMcpServersForHermeticMode,
  formatMcpHermeticDropWarn,
  isRemoteHermeticSession,
} from '../mcpHermeticFilter.js'
import {
  getFrameTimingLogPath,
  isPowerupOnboardingEnabled,
  isRemoteHermeticModeEnabled,
  resolveFrameTimingSampleEvery,
  resolvePowerupOnboardingMode,
} from '../residualFinalEnvGates.js'

describe('mcpHermeticFilter rhf/tmn', () => {
  test('no filter when neither safe nor hermetic', () => {
    const servers = {
      a: { type: 'stdio' as const },
      b: { type: 'sdk' as const },
    }
    const r = filterMcpServersForHermeticMode(servers, {
      env: {},
      argv: [],
      safeMode: false,
      hermetic: false,
    })
    expect(r.dropped).toEqual([])
    expect(r.reason).toBeUndefined()
    expect(Object.keys(r.servers)).toEqual(['a', 'b'])
  })

  test('safe mode keeps only sdk', () => {
    const servers = {
      a: { type: 'stdio' as const },
      b: { type: 'sdk' as const },
      c: { type: 'http' as const },
    }
    const r = filterMcpServersForHermeticMode(servers, {
      safeMode: true,
      hermetic: false,
    })
    expect(r.reason).toBe('safe mode')
    expect(r.dropped).toEqual(['a', 'c'])
    expect(Object.keys(r.servers)).toEqual(['b'])
  })

  test('hermetic mode keeps only sdk', () => {
    const r = filterMcpServersForHermeticMode(
      {
        x: { type: 'sse' as const },
        y: { type: 'sdk' as const },
      },
      { safeMode: false, hermetic: true },
    )
    expect(r.reason).toBe('hermetic mode')
    expect(r.dropped).toEqual(['x'])
    expect(Object.keys(r.servers)).toEqual(['y'])
  })

  test('tmn requires REMOTE and REMOTE_HERMETIC_MODE', () => {
    expect(
      isRemoteHermeticSession({
        CLAUDE_CODE_REMOTE: '1',
        CLAUDE_CODE_REMOTE_HERMETIC_MODE: '1',
      }),
    ).toBe(true)
    expect(
      isRemoteHermeticModeEnabled({
        CLAUDE_CODE_REMOTE_HERMETIC_MODE: '1',
      }),
    ).toBe(false)
    expect(
      isRemoteHermeticSession({
        CLAUDE_CODE_REMOTE: '1',
      }),
    ).toBe(false)
  })

  test('format drop warn', () => {
    expect(formatMcpHermeticDropWarn(['a'], 'safe mode')).toBe(
      '--mcp-config: 1 server ignored in safe mode: a',
    )
    expect(formatMcpHermeticDropWarn(['a', 'b'], 'hermetic mode')).toBe(
      '--mcp-config: 2 servers ignored in hermetic mode: a, b',
    )
  })
})

describe('powerup + frame timing residuals', () => {
  test('EVs powerup onboarding mode', () => {
    expect(
      resolvePowerupOnboardingMode({
        env: { CLAUDE_CODE_POWERUP_ONBOARDING: 'banner' },
      }),
    ).toBe('banner')
    expect(
      resolvePowerupOnboardingMode({
        env: { CLAUDE_CODE_POWERUP_ONBOARDING: 'step' },
      }),
    ).toBe('step')
    expect(
      resolvePowerupOnboardingMode({
        env: { CLAUDE_CODE_POWERUP_ONBOARDING: '1' },
      }),
    ).toBe('banner')
    expect(resolvePowerupOnboardingMode({ env: {} })).toBe('off')
    expect(resolvePowerupOnboardingMode({ env: {}, gbValue: 'step' })).toBe(
      'step',
    )
    expect(
      isPowerupOnboardingEnabled({ CLAUDE_CODE_POWERUP_ONBOARDING: 'banner' }),
    ).toBe(true)
    expect(isPowerupOnboardingEnabled({})).toBe(false)
  })

  test('frame timing sample every defaults to 1', () => {
    expect(resolveFrameTimingSampleEvery({})).toBe(1)
    expect(
      resolveFrameTimingSampleEvery({
        CLAUDE_CODE_FRAME_TIMING_SAMPLE_EVERY: '5',
      }),
    ).toBe(5)
    expect(
      resolveFrameTimingSampleEvery({
        CLAUDE_CODE_FRAME_TIMING_SAMPLE_EVERY: '0',
      }),
    ).toBe(1)
    expect(
      getFrameTimingLogPath({ CLAUDE_CODE_FRAME_TIMING_LOG: '/tmp/f' }),
    ).toBe('/tmp/f')
    expect(getFrameTimingLogPath({})).toBeUndefined()
  })
})
