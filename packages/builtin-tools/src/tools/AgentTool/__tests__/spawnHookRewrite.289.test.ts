/**
 * densable 2.1.289 Dn — rewritten spawn permission snapshot ($P).
 */
import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import type { Tool, ToolPermissionContext, ToolUseContext } from 'src/Tool.js'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  httpUrlsInPrompt,
  spawnRewriteRuling,
  type SpawnPermissionSnap,
} from '../spawnHookRewrite.js'

const AGENT_TOOL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'AgentTool.tsx'),
  'utf8',
)

const base: SpawnPermissionSnap = {
  prompt: 'do the thing',
  description: 'work',
  subagentType: 'Explore',
  model: undefined,
  background: false,
  cwd: undefined,
}

function perms(
  rules: ToolPermissionContext['alwaysDenyRules'],
  ask?: ToolPermissionContext['alwaysAskRules'],
): ToolPermissionContext {
  return {
    ...getEmptyToolPermissionContext(),
    alwaysDenyRules: rules,
    ...(ask !== undefined ? { alwaysAskRules: ask } : {}),
  }
}

const tool = {
  name: 'Agent',
  inputSchema: { parse: (input: unknown) => input },
  checkPermissions: async (input: unknown) => ({
    behavior: 'allow' as const,
    updatedInput: input,
  }),
} as unknown as Tool

function context(ctx: ToolPermissionContext): ToolUseContext {
  return {
    getAppState: () => ({ toolPermissionContext: ctx }),
  } as ToolUseContext
}

describe('spawnRewriteRuling', () => {
  test('identical snapshots are not a rewrite', async () => {
    const ctx = getEmptyToolPermissionContext()
    expect(
      await spawnRewriteRuling(tool, {}, base, { ...base }, context(ctx)),
    ).toBeNull()
  })

  test('Agent(Explore) is not a $P content rule', async () => {
    const ctx = perms({ userSettings: ['Agent(Explore)'] })
    expect(
      await spawnRewriteRuling(
        tool,
        {},
        base,
        { ...base, prompt: 'different' },
        context(ctx),
      ),
    ).toBeNull()
  })

  test('a tool-wide deny on the rewritten spawn is returned', async () => {
    const ctx = perms({ userSettings: ['Agent'] })
    const ruling = await spawnRewriteRuling(
      tool,
      {},
      base,
      { ...base, prompt: 'different' },
      context(ctx),
    )
    expect(ruling?.behavior).toBe('deny')
    expect(ruling?.message).toContain('Permission to use Agent')
  })

  test('the same tool-wide ask on both sides is not a new ruling', async () => {
    const ctx = perms({}, { userSettings: ['Agent'] })
    expect(
      await spawnRewriteRuling(
        tool,
        {},
        base,
        { ...base, prompt: 'different' },
        context(ctx),
      ),
    ).toBeNull()
  })

  test('fn: unknown subagentType is a deny; fork is not a listed known type', () => {
    expect(AGENT_TOOL).toContain("a hook's subagentType")
    expect(AGENT_TOOL).toContain(
      'arrived.subagentType === subagent_type || agents.some(agent => agent.agentType === arrived.subagentType)',
    )
    const fn = AGENT_TOOL.indexOf('densable fn')
    const slice = AGENT_TOOL.slice(fn, fn + 900)
    expect(slice).not.toContain('FORK_SUBAGENT_TYPE')
    expect(slice).not.toContain('isForkSubagentProductEnabled')
  })

  test('a prompt content rule that appears only on the rewritten spawn is returned', async () => {
    const ctx = perms({}, { userSettings: ['Agent(prompt:secret*)'] })
    const ruling = await spawnRewriteRuling(
      tool,
      {},
      base,
      { ...base, prompt: 'secret plan' },
      context(ctx),
    )
    expect(ruling?.behavior).toBe('ask')
    expect(ruling?.message.length).toBeGreaterThan(0)
  })
})

describe('httpUrlsInPrompt', () => {
  test('trims trailing punctuation and stops after 8', () => {
    const urls = httpUrlsInPrompt(
      'see https://example.com/a. and https://example.com/b)',
    )
    expect(urls).toEqual(['https://example.com/a', 'https://example.com/b'])
    const many = Array.from(
      { length: 9 },
      (_, i) => `https://e.test/${i}`,
    ).join(' ')
    expect(httpUrlsInPrompt(many)).toHaveLength(9)
  })
})
