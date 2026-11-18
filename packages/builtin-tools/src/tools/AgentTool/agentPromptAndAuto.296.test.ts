import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getPrompt } from './prompt.js'

describe('AgentTool 2.1.292-2.1.296 alignment', () => {
  test('#293: getPrompt omits SendMessage continuation instructions when continueAvailable is false (full & lean)', async () => {
    const fullDisabled = await getPrompt([], false, undefined, {
      continueAvailable: false,
      leanPrompt: false,
    })
    expect(fullDisabled).toContain(
      'A previously spawned agent cannot be continued from here. Every Agent call starts a fresh agent with no memory of prior runs',
    )
    expect(fullDisabled).not.toContain('use SendMessage with the agent')

    const leanDisabled = await getPrompt([], false, undefined, {
      continueAvailable: false,
      leanPrompt: true,
    })
    expect(leanDisabled).toContain(
      'A previously spawned agent cannot be continued from here; every Agent call starts fresh',
    )
    expect(leanDisabled).not.toContain('Use SendMessage with the agent')

    const fullEnabled = await getPrompt([], false, undefined, {
      continueAvailable: true,
      leanPrompt: false,
    })
    expect(fullEnabled).toContain(
      'To continue a previously spawned agent, use SendMessage with the agent',
    )
  })

  test('#199: runAgent.ts checks getAutoModeUnavailableReason(resolvedAgentModel) before entering auto mode', () => {
    const src = readFileSync(join(import.meta.dir, 'runAgent.ts'), 'utf8')
    expect(src).toContain('getAutoModeUnavailableReason(resolvedAgentModel)')
    expect(src).toContain(
      "Subagent definition's permissionMode would put it in auto mode, but auto mode is unavailable to this subagent",
    )
  })
})
