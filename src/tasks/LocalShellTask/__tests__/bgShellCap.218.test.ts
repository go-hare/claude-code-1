/**
 * densable 2.1.218 #21 — fkd subagent bg shell capMs resolution.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  DEFAULT_SUBAGENT_BG_SHELL_MAX_MS,
  resolveSubagentBgShellCapMs,
} from '../LocalShellTask.js'
import type { AgentId } from '../../../types/ids.js'

describe('densable 2.1.218 #21 resolveSubagentBgShellCapMs (fkd)', () => {
  const prev = process.env.CLAUDE_SUBAGENT_BG_SHELL_MAX_MS

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.CLAUDE_SUBAGENT_BG_SHELL_MAX_MS
    } else {
      process.env.CLAUDE_SUBAGENT_BG_SHELL_MAX_MS = prev
    }
  })

  test('main-thread (agentId undefined) → no cap', () => {
    expect(resolveSubagentBgShellCapMs(undefined)).toBeUndefined()
  })

  test('agent-scoped defaults to 1h (ZV_=3600000)', () => {
    delete process.env.CLAUDE_SUBAGENT_BG_SHELL_MAX_MS
    expect(resolveSubagentBgShellCapMs('agent-1' as AgentId)).toBe(
      DEFAULT_SUBAGENT_BG_SHELL_MAX_MS,
    )
    expect(DEFAULT_SUBAGENT_BG_SHELL_MAX_MS).toBe(3_600_000)
  })

  test('honors CLAUDE_SUBAGENT_BG_SHELL_MAX_MS env', () => {
    process.env.CLAUDE_SUBAGENT_BG_SHELL_MAX_MS = '120000'
    expect(resolveSubagentBgShellCapMs('agent-2' as AgentId)).toBe(120_000)
  })

  test('invalid env falls back to default', () => {
    process.env.CLAUDE_SUBAGENT_BG_SHELL_MAX_MS = 'nope'
    expect(resolveSubagentBgShellCapMs('agent-3' as AgentId)).toBe(
      DEFAULT_SUBAGENT_BG_SHELL_MAX_MS,
    )
  })
})
