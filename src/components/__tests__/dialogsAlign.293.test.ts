import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isNotificationVisible } from '../../context/notifications.js'
import {
  rewriteResumedSubagentShutdownToolResults,
  SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE,
} from '../../utils/messages.js'
import { cyclePickerEffort } from '../ModelPicker.js'
import { getAsyncAgentDetailAgentType } from '../tasks/AsyncAgentDetailDialog.js'

describe('Official 2.1.293 #291 ModelPicker effort clamping', () => {
  const levels = ['low', 'medium', 'high', 'max'] as const

  test('right at max clamps to max instead of wrapping to low', () => {
    expect(cyclePickerEffort('max', 'right', levels)).toBe('max')
  })

  test('left at low clamps to low instead of wrapping to max', () => {
    expect(cyclePickerEffort('low', 'left', levels)).toBe('low')
  })

  test('steps normally between interior levels', () => {
    expect(cyclePickerEffort('medium', 'right', levels)).toBe('high')
    expect(cyclePickerEffort('high', 'left', levels)).toBe('medium')
  })
})

describe('Official 2.1.293 #298 AsyncAgentDetailDialog agentType fallback', () => {
  test('uses selectedAgent.agentType when present, else falls back to agent.agentType', () => {
    expect(
      getAsyncAgentDetailAgentType({
        selectedAgent: { agentType: 'worker' },
        agentType: 'general-purpose',
      }),
    ).toBe('worker')

    expect(
      getAsyncAgentDetailAgentType({
        selectedAgent: undefined,
        agentType: 'worker',
      }),
    ).toBe('worker')
  })
})

describe('Official 2.1.292 #266 rate limit settings link uses https://', () => {
  test('CONSUMER_USAGE_SETTINGS_URL includes https://claude.ai/settings/usage?from=cc_cli_limit_message', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/rateLimitMessages.ts'),
      'utf8',
    )
    expect(src).toContain(
      "'https://claude.ai/settings/usage?from=cc_cli_limit_message'",
    )
  })
})

describe('Official 2.1.296 #499 interruptedByShutdown subagent copy', () => {
  test('rewriteResumedSubagentShutdownToolResults rewrites shutdown-interrupted tool_result blocks', () => {
    const userMsg = {
      type: 'user' as const,
      uuid: 'u1' as `${string}-${string}-${string}-${string}-${string}`,
      timestamp: new Date().toISOString(),
      interruptedByShutdown: true,
      toolUseResult: 'User rejected tool use',
      message: {
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'tu1',
            content: 'User rejected tool use',
          },
        ],
      },
    }

    const [rewritten] = rewriteResumedSubagentShutdownToolResults([userMsg])
    expect(rewritten?.type).toBe('user')
    if (rewritten?.type === 'user') {
      expect(rewritten.toolUseResult).toBe(
        SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE,
      )
      expect(rewritten.message?.content).toEqual([
        {
          type: 'tool_result',
          tool_use_id: 'tu1',
          content: SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE,
        },
      ])
    }
  })
})

describe('Official 2.1.296 #503 DiffDialog holds toasts and flushes on close', () => {
  test('DiffDialog.tsx sets paneHoldsToasts and calls processQueue on cleanup', () => {
    const src = readFileSync(
      join(import.meta.dir, '../diff/DiffDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('paneHoldsToasts: true')
    expect(src).toContain('paneHoldsToasts: false')
    expect(src).toContain('processQueue()')
  })

  test('isNotificationVisible hides non-exempt toasts while held and shows exempt ones', () => {
    const normal = { key: 'a', text: 'hi', priority: 'medium' as const }
    const exempt = {
      key: 'b',
      text: 'token',
      priority: 'medium' as const,
      exemptFromDiffPanelHold: true,
    }
    expect(isNotificationVisible(normal, true)).toBe(false)
    expect(isNotificationVisible(exempt, true)).toBe(true)
    expect(isNotificationVisible(normal, false)).toBe(true)
  })
})
