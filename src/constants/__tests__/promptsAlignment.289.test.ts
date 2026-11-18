import { afterEach, describe, expect, test } from 'bun:test'
import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import { getSubagentSteerDelegationSection } from '../goldPromptSections.js'
import { getStaticMemoryPrompt } from '../../memdir/memdir.js'

describe('prompts 2.1.289 alignment (subagent_steer_delegation + memory_static)', () => {
  const prevSteer = process.env.CLAUDE_CODE_THISTLE_GREBE
  const prevDisableAutoMemory = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  const prevCowork = process.env.CLAUDE_COWORK_MEMORY_GUIDELINES

  afterEach(() => {
    if (prevSteer === undefined) delete process.env.CLAUDE_CODE_THISTLE_GREBE
    else process.env.CLAUDE_CODE_THISTLE_GREBE = prevSteer
    if (prevDisableAutoMemory === undefined)
      delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    else process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = prevDisableAutoMemory
    if (prevCowork === undefined)
      delete process.env.CLAUDE_COWORK_MEMORY_GUIDELINES
    else process.env.CLAUDE_COWORK_MEMORY_GUIDELINES = prevCowork
  })

  test('subagent_steer_delegation emits ## Delegating to subagents only when Agent is enabled and counter_steer is active', () => {
    process.env.CLAUDE_CODE_THISTLE_GREBE = 'counter_steer'
    expect(getSubagentSteerDelegationSection(new Set(['Read']))).toBeNull()
    const section = getSubagentSteerDelegationSection(
      new Set(['Read', AGENT_TOOL_NAME]),
    )
    expect(section).toContain('## Delegating to subagents')
    expect(section).toContain(AGENT_TOOL_NAME)

    process.env.CLAUDE_CODE_THISTLE_GREBE = 'default'
    expect(
      getSubagentSteerDelegationSection(new Set([AGENT_TOOL_NAME])),
    ).toBeNull()
  })

  test('getStaticMemoryPrompt returns static auto memory prompt without reading MEMORY.md', () => {
    delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    process.env.CLAUDE_COWORK_MEMORY_GUIDELINES = 'Static guideline line.'
    expect(getStaticMemoryPrompt()).toBe(
      '# auto memory\nStatic guideline line.',
    )

    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    expect(getStaticMemoryPrompt()).toBeNull()
  })
})
