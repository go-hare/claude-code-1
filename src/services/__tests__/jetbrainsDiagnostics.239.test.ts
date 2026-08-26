import { afterEach, describe, expect, test } from 'bun:test'
import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'
import { mock } from 'bun:test'

mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.ts', debugMock)

import {
  DiagnosticTrackingService,
  IDE_DIAGNOSTICS_BASELINE_TIMEOUT_LIMIT,
  JETBRAINS_IDE_PLUGIN_NAME,
} from '../diagnosticTracking.js'

describe('densable 2.1.239 #10 JetBrains diagnostics skip', () => {
  afterEach(async () => {
    await DiagnosticTrackingService.getInstance().shutdown()
  })

  test('beforeFileEdited no-ops when IDE is JetBrains plugin (ABS)', async () => {
    const svc = DiagnosticTrackingService.getInstance()
    svc.initialize({
      type: 'connected',
      name: 'ide',
      serverInfo: { name: JETBRAINS_IDE_PLUGIN_NAME, version: '1' },
    } as never)
    // Official ABS skip is before callIdeRpc — must not hang or throw.
    await svc.beforeFileEdited('/tmp/a.ts')
    const priv = svc as unknown as { baseline: Map<string, unknown> }
    expect(priv.baseline.size).toBe(0)
  })

  test('beforeFileEdited skips after _ol consecutive baseline timeouts', async () => {
    const svc = DiagnosticTrackingService.getInstance()
    svc.initialize({
      type: 'connected',
      name: 'ide',
      serverInfo: { name: 'vscode', version: '1' },
    } as never)
    const priv = svc as unknown as {
      consecutiveBaselineTimeouts: number
      baseline: Map<string, unknown>
    }
    priv.consecutiveBaselineTimeouts = IDE_DIAGNOSTICS_BASELINE_TIMEOUT_LIMIT
    await svc.beforeFileEdited('/tmp/a.ts')
    expect(priv.baseline.size).toBe(0)
  })
})
