import { describe, expect, test } from 'bun:test'
import {
  isDaemonInjectedForceColor,
  shouldStripDaemonForceColor,
  stripDaemonForceColorFromEnv,
} from './envUtils.js'

describe('envUtils FORCE_COLOR stripping v2.1.295 (#383)', () => {
  test('#383: detects daemon-injected FORCE_COLOR=3 and strips when not in settingsEnvForChildren', () => {
    const daemonEnv = {
      CLAUDE_BG_BACKEND: 'daemon',
      FORCE_COLOR: '3',
    } as NodeJS.ProcessEnv
    expect(isDaemonInjectedForceColor(daemonEnv)).toBe(true)
    expect(shouldStripDaemonForceColor({}, daemonEnv)).toBe(true)

    const childEnv: Record<string, string | undefined> = {
      FOO: '1',
      FORCE_COLOR: '3',
    }
    stripDaemonForceColorFromEnv(childEnv, {}, daemonEnv)
    expect(childEnv.FORCE_COLOR).toBeUndefined()
    expect(childEnv.FOO).toBe('1')
  })

  test('#383: preserves FORCE_COLOR when explicitly set in settingsEnvForChildren', () => {
    const daemonEnv = {
      CLAUDE_BG_BACKEND: 'daemon',
      FORCE_COLOR: '3',
    } as NodeJS.ProcessEnv
    const settingsEnv = { FORCE_COLOR: '1' }
    expect(shouldStripDaemonForceColor(settingsEnv, daemonEnv)).toBe(false)

    const childEnv: Record<string, string | undefined> = { FORCE_COLOR: '1' }
    stripDaemonForceColorFromEnv(childEnv, settingsEnv, daemonEnv)
    expect(childEnv.FORCE_COLOR).toBe('1')
  })

  test('#383: does not strip FORCE_COLOR outside daemon backend', () => {
    const normalEnv = { FORCE_COLOR: '3' } as NodeJS.ProcessEnv
    expect(isDaemonInjectedForceColor(normalEnv)).toBe(false)
    expect(shouldStripDaemonForceColor({}, normalEnv)).toBe(false)
  })
})
