import { afterEach, describe, expect, test } from 'bun:test'
import { getAgentModel, getDefaultSubagentModel } from '../agent.js'

const parent = 'claude-sonnet-4-6'

describe('CLAUDE_CODE_SUBAGENT_MODEL is the default (2.1.251 #58)', () => {
  const previous = process.env.CLAUDE_CODE_SUBAGENT_MODEL

  afterEach(() => {
    if (previous === undefined) delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    else process.env.CLAUDE_CODE_SUBAGENT_MODEL = previous
  })

  test('sY returns env when set and not inherit', () => {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku'
    expect(getDefaultSubagentModel()).toBe('haiku')
  })

  test('sY returns inherit when unset or inherit', () => {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    expect(getDefaultSubagentModel()).toBe('inherit')
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'inherit'
    expect(getDefaultSubagentModel()).toBe('inherit')
  })

  test('an agent model wins over the env default', () => {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    const opus = getAgentModel('opus', parent)
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku'
    expect(getAgentModel('opus', parent)).toBe(opus)
  })

  test('a per-spawn model wins over the env default', () => {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    const haiku = getAgentModel('haiku', parent)
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'opus'
    expect(getAgentModel('sonnet', parent, 'haiku')).toBe(haiku)
  })

  test('per-spawn model wins over agent model', () => {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    const haiku = getAgentModel(undefined, parent, 'haiku')
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'opus'
    expect(getAgentModel('opus', parent, 'haiku')).toBe(haiku)
  })

  test('explicit agent inherit stays on the parent', () => {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    const inherited = getAgentModel('inherit', parent)
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku'
    expect(getAgentModel('inherit', parent)).toBe(inherited)
  })

  test('explicit per-spawn inherit stays on the parent', () => {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    const inherited = getAgentModel(undefined, parent, 'inherit')
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku'
    expect(getAgentModel('opus', parent, 'inherit')).toBe(inherited)
  })

  test('env applies only when the agent model is unset', () => {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    const haiku = getAgentModel('haiku', parent)
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'haiku'
    expect(getAgentModel(undefined, parent)).toBe(haiku)
  })

  test('sY inherit (unset or inherit) falls back to the parent', () => {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL
    const inherited = getAgentModel(undefined, parent)
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = 'inherit'
    expect(getAgentModel(undefined, parent)).toBe(inherited)
  })
})
