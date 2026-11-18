import { afterEach, describe, expect, test } from 'bun:test'
import { formatPluginDetailsNotFoundMessage } from '../plugins.js'
import {
  drainSettingsWrites,
  runInSettingsWriteQueue,
} from '../../../utils/settings/settings.js'

describe('plugins CLI v2.1.302 (#902, #914)', () => {
  afterEach(async () => {
    await drainSettingsWrites()
  })

  test('#902: drainSettingsWrites waits for queued settings writes before CLI exit', async () => {
    let finished = false
    const pending = runInSettingsWriteQueue(
      '/tmp/test-settings-902.json',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 25))
        finished = true
      },
    )
    expect(finished).toBe(false)
    await drainSettingsWrites()
    expect(finished).toBe(true)
    await pending
  })

  test('#914: formatPluginDetailsNotFoundMessage points @builtin to /plugin instead of claude plugin list', () => {
    const builtinMsg = formatPluginDetailsNotFoundMessage('my-plugin@builtin')
    expect(builtinMsg).toContain(
      "Built-in plugins don't appear in `claude plugin list`",
    )
    expect(builtinMsg).toContain('/plugin')

    const regularMsg = formatPluginDetailsNotFoundMessage('my-plugin@official')
    expect(regularMsg).toContain(
      'Run `claude plugin list` to see installed plugins',
    )
    expect(regularMsg).not.toContain('Installed tab')
  })
})
