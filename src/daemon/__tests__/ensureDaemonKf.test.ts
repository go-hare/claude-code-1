import { describe, expect, test } from 'bun:test'
import { daemonSpawnedByLabel, buildSpawnedByPayload } from '../daemonLock.js'
import { planDaemonColdStart } from '../../utils/residualFinalEnvGates.js'

describe('KF densable helpers', () => {
  test('planDaemonColdStart forceTransient always spawns', () => {
    const plan = planDaemonColdStart({
      forceTransient: true,
      mayPromptInstall: true,
      installPromptDismissed: false,
      settingsMode: 'ask',
    })
    expect(plan.action).toBe('spawn_transient')
  })

  test('planDaemonColdStart ask + may prompt + not dismissed', () => {
    const plan = planDaemonColdStart({
      forceTransient: false,
      mayPromptInstall: true,
      installPromptDismissed: false,
      settingsMode: 'ask',
      gbDefault: 'ask',
    })
    expect(plan.action).toBe('ask_install')
  })

  test('spawned-by payload is valid JSON for Ay6 argv', () => {
    const payload = buildSpawnedByPayload({
      label: daemonSpawnedByLabel(['agents']),
      cwd: '/tmp/proj',
      pid: 7,
    })
    expect(JSON.parse(payload).label).toBe('claude agents')
  })
})
