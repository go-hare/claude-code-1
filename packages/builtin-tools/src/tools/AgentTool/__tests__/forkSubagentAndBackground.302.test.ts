import { afterEach, describe, expect, test } from 'bun:test'
import { setIsInteractive } from 'src/bootstrap/state.js'
import type { AssistantMessage } from 'src/types/message.js'
import {
  buildForkedMessages,
  FORK_OWN_NON_AGENT_PLACEHOLDER_RESULT,
  FORK_OWN_PLACEHOLDER_RESULT,
  FORK_SIBLING_PLACEHOLDER_RESULT,
  isForkSubagentForceAsyncEnabled,
  isForkSubagentProductEnabled,
  resetForkSubagentProductSource,
} from '../forkSubagent.js'

const origForkEnv = process.env.CLAUDE_CODE_FORK_SUBAGENT
const origEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT

afterEach(() => {
  resetForkSubagentProductSource()
  setIsInteractive(true)
  if (origForkEnv === undefined) delete process.env.CLAUDE_CODE_FORK_SUBAGENT
  else process.env.CLAUDE_CODE_FORK_SUBAGENT = origForkEnv
  if (origEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
  else process.env.CLAUDE_CODE_ENTRYPOINT = origEntrypoint
})

describe('Fork subagent defaults (#924, #925) & parallel fork ids (#1098)', () => {
  test('#924: enabled by default in non-interactive sessions (claude -p / SDK / desktop / VS Code)', () => {
    delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    setIsInteractive(false)
    expect(isForkSubagentProductEnabled()).toBe(true)
  })

  test('#924: CLAUDE_CODE_FORK_SUBAGENT=0 disables fork subagents and mcp entrypoint disables them', () => {
    setIsInteractive(false)
    process.env.CLAUDE_CODE_FORK_SUBAGENT = '0'
    expect(isForkSubagentProductEnabled()).toBe(false)

    delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    resetForkSubagentProductSource()
    process.env.CLAUDE_CODE_ENTRYPOINT = 'mcp'
    expect(isForkSubagentProductEnabled()).toBe(false)
  })

  test('#925: force-async is true in terminal, desktop, and VS Code; false in claude -p / SDK unless env=1', () => {
    delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    setIsInteractive(true)
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    expect(isForkSubagentForceAsyncEnabled()).toBe(true)

    resetForkSubagentProductSource()
    setIsInteractive(false)
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'
    expect(isForkSubagentForceAsyncEnabled()).toBe(true)

    resetForkSubagentProductSource()
    process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-vscode'
    expect(isForkSubagentForceAsyncEnabled()).toBe(true)

    resetForkSubagentProductSource()
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts'
    expect(isForkSubagentForceAsyncEnabled()).toBe(false)

    resetForkSubagentProductSource()
    process.env.CLAUDE_CODE_FORK_SUBAGENT = '1'
    expect(isForkSubagentForceAsyncEnabled()).toBe(true)
  })

  test('#1098: buildForkedMessages identifies own toolUseId vs sibling calls', () => {
    const assistantMsg = {
      type: 'assistant',
      uuid: 'parent-uuid',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu-1', name: 'Agent', input: {} },
          { type: 'tool_use', id: 'tu-2', name: 'Agent', input: {} },
          { type: 'tool_use', id: 'tu-3', name: 'Bash', input: {} },
        ],
      },
    } as unknown as AssistantMessage

    const [, userMsg] = buildForkedMessages('do task 2', assistantMsg, 'tu-2')
    const blocks = (
      userMsg as {
        message: {
          content: Array<{
            type: string
            tool_use_id?: string
            content?: Array<{ text: string }>
          }>
        }
      }
    ).message.content
    const r1 = blocks.find(b => b.tool_use_id === 'tu-1')
    const r2 = blocks.find(b => b.tool_use_id === 'tu-2')
    const r3 = blocks.find(b => b.tool_use_id === 'tu-3')
    expect(r1?.content?.[0]?.text).toBe(FORK_SIBLING_PLACEHOLDER_RESULT)
    expect(r2?.content?.[0]?.text).toBe(FORK_OWN_PLACEHOLDER_RESULT)
    expect(r3?.content?.[0]?.text).toBe(FORK_SIBLING_PLACEHOLDER_RESULT)

    // Non-Agent tool_use fork uses A9r
    const [, nonAgentUserMsg] = buildForkedMessages(
      'do task 3',
      assistantMsg,
      'tu-3',
    )
    const blocks2 = (
      nonAgentUserMsg as {
        message: {
          content: Array<{
            type: string
            tool_use_id?: string
            content?: Array<{ text: string }>
          }>
        }
      }
    ).message.content
    expect(
      blocks2.find(b => b.tool_use_id === 'tu-3')?.content?.[0]?.text,
    ).toBe(FORK_OWN_NON_AGENT_PLACEHOLDER_RESULT)
  })
})
