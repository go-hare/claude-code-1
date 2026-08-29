/**
 * densable 2.1.239 dZa — initializeIdeIntegration r(status|null).
 *
 * VSCode r(status) shells out via already-bound execFileNoThrow; mock.module
 * cannot intercept it. That branch is source-locked in ideOnboardingNms.239.
 * JetBrains goes through isJetBrainsPluginInstalledCached (mockable).
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

import * as realJetbrains from 'src/utils/jetbrains.js'
import * as realSleep from 'src/utils/sleep.js'

const jetbrainsSnap = snapshotModuleExports(realJetbrains)
const sleepSnap = snapshotModuleExports(realSleep)

let jetbrainsInstalled = false
let onboardingShown = false

mock.module('src/utils/jetbrains.js', () => ({
  ...jetbrainsSnap,
  isJetBrainsPluginInstalledCached: async () => jetbrainsInstalled,
}))
mock.module('src/utils/jetbrains.ts', () => ({
  ...jetbrainsSnap,
  isJetBrainsPluginInstalledCached: async () => jetbrainsInstalled,
}))

mock.module('src/utils/sleep.js', () => ({
  ...sleepSnap,
  sleep: async (_ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) return
  },
}))
mock.module('src/utils/sleep.ts', () => ({
  ...sleepSnap,
  sleep: async (_ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) return
  },
}))

mock.module('src/components/IdeOnboardingDialog.js', () => ({
  hasIdeOnboardingDialogBeenShown: () => onboardingShown,
  IdeOnboardingDialog: () => null,
}))
mock.module('src/components/IdeOnboardingDialog.tsx', () => ({
  hasIdeOnboardingDialogBeenShown: () => onboardingShown,
  IdeOnboardingDialog: () => null,
}))

const { cancelCurrentIDESearch, initializeIdeIntegration } =
  require('../ide.js') as typeof import('../ide.js')

type Status = {
  installed: boolean
  error: string | null
  installedVersion: string | null
  ideType: string | null
}

async function waitUntil(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return
    await Bun.sleep(10)
  }
  throw new Error('timed out waiting for dZa callback')
}

afterEach(() => {
  cancelCurrentIDESearch()
  jetbrainsInstalled = false
  onboardingShown = false
})

afterAll(() => {
  mock.module('src/utils/jetbrains.js', () => jetbrainsSnap)
  mock.module('src/utils/jetbrains.ts', () => jetbrainsSnap)
  mock.module('src/utils/sleep.js', () => sleepSnap)
  mock.module('src/utils/sleep.ts', () => sleepSnap)
})

describe('dZa initializeIdeIntegration', () => {
  test('JetBrains r(null) when plugin already installed', async () => {
    jetbrainsInstalled = true
    const shown: Array<Status | null> = []
    void initializeIdeIntegration(
      () => {},
      'pycharm',
      status => {
        shown.push(status)
      },
      () => {},
    )
    cancelCurrentIDESearch()
    await waitUntil(() => shown.length > 0)
    expect(shown[0]).toBeNull()
  })

  test('already-shown latch skips r()', async () => {
    onboardingShown = true
    jetbrainsInstalled = true
    const shown: Array<Status | null> = []
    void initializeIdeIntegration(
      () => {},
      'pycharm',
      status => {
        shown.push(status)
      },
      () => {},
    )
    cancelCurrentIDESearch()
    await Bun.sleep(50)
    expect(shown).toEqual([])
  })
})
