import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'
import { shouldWarnHighTokenUsage } from '../../commands/autocompact/autocompact.js'
import { shouldEvictPanelTask } from '../../components/CoordinatorAgentStatus.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { jsonStringify } from '../slowOperations.js'

describe('Wave 4B 2.1.300 alignment', () => {
  test('#762 PromptInput wires createPromptChangeCoordinator for non-typed edits', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(src).toContain('createPromptChangeCoordinator')
    expect(src).toContain("origin: { kind: 'landing' }")
    expect(src).toContain("{ kind: 'composer' }")
    expect(src).toContain("{ kind: 'undo' }")
    expect(src).toContain("{ kind: 'history' }")
    expect(src).toContain("{ kind: 'clear' }")
  })

  test('#764 shouldWarnHighTokenUsage only warns when selected window exceeds auto window', () => {
    // Choosing a smaller window than auto (100k <= 200k) should NOT warn
    expect(
      shouldWarnHighTokenUsage('claude-sonnet-4-6', 100_000, 200_000),
    ).toBe(false)
    // Choosing a larger window than auto (900k > 500k) on a 1M model SHOULD warn
    expect(
      shouldWarnHighTokenUsage('claude-sonnet-4-6[1m]', 900_000, 500_000),
    ).toBe(true)
    // Capped by model context window (200k): min(200k, 900k) <= 200k should NOT warn
    expect(
      shouldWarnHighTokenUsage('claude-sonnet-4-6', 900_000, 200_000),
    ).toBe(false)
  })

  test('#770 shouldEvictPanelTask preserves completed parent while viewing child', () => {
    const now = 10_000
    const parentTask = {
      id: 'parent-1',
      type: 'local_agent',
      status: 'completed',
      description: 'parent',
      prompt: 'p',
      selectedAgent: undefined as never,
      agentId: 'parent-1',
      messages: [],
      pendingMessages: [],
      retain: true,
      isBackgrounded: true,
      startTime: 1000,
      evictAfter: 5000,
      outputFile: '/tmp/p',
      outputOffset: 0,
      notified: true,
    } as unknown as LocalAgentTaskState

    expect(shouldEvictPanelTask(parentTask, now, new Set(['parent-1']))).toBe(
      false,
    )
    expect(shouldEvictPanelTask(parentTask, now, new Set())).toBe(true)
  })

  test('#777 jsonStringify escapes U+2028 and U+2029 so JSONL lines stay intact', () => {
    const payload = { text: 'before\u2028line\u2029after' }
    const serialized = jsonStringify(payload)
    expect(serialized).not.toContain('\u2028')
    expect(serialized).not.toContain('\u2029')
    expect(serialized).toContain('\\u2028')
    expect(serialized).toContain('\\u2029')
    expect(JSON.parse(serialized)).toEqual(payload)
  })
})
