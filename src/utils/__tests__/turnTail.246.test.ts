/**
 * densable 2.1.246 #55 turn-tail ze/re/sn/rn.
 * Host is workflow harness sMt @214733983.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  analyzeTurnTail,
  getTurnTail,
  isStrictHumanTurnTail,
  isUserDrivenTurn,
} from '../turnTail.js'
import {
  applyWorkflowHarnessPrompt,
  classifyWorkflowHarnessRelay,
  wrapComputedWorkflowTask,
} from '../workflowHarness.js'

const src = readFileSync(join(import.meta.dir, '../turnTail.ts'), 'utf8')
const harness = readFileSync(
  join(import.meta.dir, '../workflowHarness.ts'),
  'utf8',
)
const backend = readFileSync(
  join(import.meta.dir, '../../workflow/backends/claudeCodeBackend.ts'),
  'utf8',
)

afterEach(() => {
  delete process.env.CLAUDE_CODE_WORKFLOW_PROMPT_PROVENANCE
})

describe('#55 turn-tail ze (2.1.246)', () => {
  test('source-locks official ze/re/sn/rn and sMt host', () => {
    expect(src).toContain('ze @209362700')
    expect(src).toContain('export function analyzeTurnTail(')
    expect(src).toContain('export function getTurnTail(')
    expect(src).toContain('export function isUserDrivenTurn(')
    expect(src).toContain('export function isStrictHumanTurnTail(')
    expect(src).toContain('tengu_turn_tail_analysis_degraded')
    expect(src).toContain('isUserMessageWithPairedToolResultsOnly(messages, s)')
    expect(harness).toContain('sMt @214733983')
    expect(harness).toContain('[Workflow harness — computed task]')
    expect(harness).toContain('[Workflow harness — user request]')
    expect(harness).toContain('[Workflow harness — automated trigger]')
    expect(backend).toContain('applyWorkflowHarnessPrompt(')
    expect(backend).toContain('toolUseContext.messages')
  })

  test('human user tail is userDriven + strictHuman; Ze pairing is skipped', () => {
    const assistant = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'prior' }] },
    }
    const user = {
      type: 'user',
      origin: { kind: 'human' as const },
      message: { content: [{ type: 'text', text: 'do the thing' }] },
    }
    const tail = analyzeTurnTail([assistant, user])
    expect(tail.decider?.userDriven).toBe(true)
    expect(tail.decider?.strictHuman).toBe(true)
    expect(tail.decider?.text).toBe('do the thing')
    expect(tail.referentTail).toBe('prior')
    expect(isUserDrivenTurn([assistant, user])).toBe(true)
    expect(isStrictHumanTurnTail([assistant, user])).toBe(true)

    const toolAssistant = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1' }] },
    }
    const toolUser = {
      type: 'user',
      origin: { kind: 'human' as const },
      message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] },
    }
    const skipped = analyzeTurnTail([toolAssistant, toolUser])
    expect(skipped.decider).toBeNull()
  })

  test('scheduled-trigger origin is automated harness', () => {
    const user = {
      type: 'user',
      origin: {
        kind: 'task-notification' as const,
        subkind: 'scheduled-trigger',
      },
      message: { content: [{ type: 'text', text: 'cron' }] },
    }
    expect(getTurnTail([user]).scheduledTrigger).toBe(true)
    expect(classifyWorkflowHarnessRelay([user]).kind).toBe('automated')
  })

  test('sMt relay + provenance wrap matches official spawn', () => {
    const assistant = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'ctx' }] },
    }
    const user = {
      type: 'user',
      origin: { kind: 'human' as const },
      message: { content: [{ type: 'text', text: 'ship it' }] },
    }
    expect(classifyWorkflowHarnessRelay([assistant, user])).toEqual({
      kind: 'relay',
      userText: 'ship it',
      referentTail: 'ctx',
    })
    expect(applyWorkflowHarnessPrompt([assistant, user], 'computed')).toBe(
      'computed',
    )
    process.env.CLAUDE_CODE_WORKFLOW_PROMPT_PROVENANCE = '1'
    const wrapped = applyWorkflowHarnessPrompt([assistant, user], 'computed')
    expect(wrapped).toContain('[Workflow harness — user request]')
    expect(wrapped).toContain('  ship it')
    expect(wrapped).toContain('[Workflow harness — assistant context]')
    expect(wrapped).toContain('  ctx')
    expect(wrapped).toContain('[Workflow harness — computed task]')
    expect(wrapped).toContain('  computed')
    expect(wrapComputedWorkflowTask('x')).toContain('  x')
  })
})
