/**
 * densable 2.1.239 leftover — GIe / Cgr / snt / kgr / dpw / _tm.
 * No mock.module (shared process with residualEnvGates).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import { __resetWebFetchAgentEnabledForTests } from '../built-in/webFetchAgent.js'
import {
  admitWebFetchTool,
  isWebFetchReadmissionDenied,
  parseAgentToolsWildcard,
  SKILL_TOOL_NAME_PREFIX,
  toolsListMentions,
  webFetchHookBlockedHint,
} from 'src/utils/webFetchAdmission.js'
import { WEB_FETCH_TOOL_NAME } from '../../WebFetchTool/prompt.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function tool(name: string, extra: { isMcp?: boolean } = {}) {
  return { name, isEnabled: () => true, ...extra }
}

const saved = {
  webFetch: process.env.CLAUDE_CODE_WEB_FETCH_AGENT,
  simple: process.env.CLAUDE_CODE_SIMPLE,
}

beforeEach(() => {
  __resetWebFetchAgentEnabledForTests()
})

afterEach(() => {
  if (saved.webFetch === undefined) {
    delete process.env.CLAUDE_CODE_WEB_FETCH_AGENT
  } else {
    process.env.CLAUDE_CODE_WEB_FETCH_AGENT = saved.webFetch
  }
  if (saved.simple === undefined) {
    delete process.env.CLAUDE_CODE_SIMPLE
  } else {
    process.env.CLAUDE_CODE_SIMPLE = saved.simple
  }
  __resetWebFetchAgentEnabledForTests()
})

describe('densable 2.1.239 WebFetch readmission leftover', () => {
  test('snt / kgr gold', () => {
    expect(parseAgentToolsWildcard(undefined)).toEqual({})
    expect(parseAgentToolsWildcard(['Bash', 'Read'])).toBeNull()
    expect(parseAgentToolsWildcard(['*'])).toEqual({})
    expect(parseAgentToolsWildcard(['*', 'Agent(web-fetch)'])).toEqual({
      allowedAgentTypes: ['web-fetch'],
    })
    expect(parseAgentToolsWildcard(['*', 'Bash'])).toBeNull()
    expect(toolsListMentions(['WebFetch'], WEB_FETCH_TOOL_NAME)).toBe(true)
    expect(toolsListMentions(['Agent(web-fetch)'], 'Agent')).toBe(true)
    expect(toolsListMentions(undefined, WEB_FETCH_TOOL_NAME)).toBe(false)
  })

  test('dpw on main (no ALS) is false — official OB() undefined via getMainThreadAgentType', () => {
    expect(
      isWebFetchReadmissionDenied({
        options: { agentDefinitions: { activeAgents: [] } },
      }),
    ).toBe(false)
  })

  test('GIe is a no-op when Cgr is off', () => {
    delete process.env.CLAUDE_CODE_WEB_FETCH_AGENT
    const pool = [tool('Agent'), tool('Bash')]
    const next = admitWebFetchTool(
      { tools: ['WebFetch'] },
      pool as never,
      getEmptyToolPermissionContext(),
      {
        activeAgents: [{ agentType: 'web-fetch', source: 'built-in' }],
      },
    )
    expect(next as object).toBe(pool)
  })

  test('GIe splices WebFetch when Cgr holds and spec lists it', () => {
    process.env.CLAUDE_CODE_WEB_FETCH_AGENT = '1'
    delete process.env.CLAUDE_CODE_SIMPLE
    const pool = [tool('Agent'), tool('Bash')]
    const next = admitWebFetchTool(
      { tools: ['WebFetch'] },
      pool as never,
      getEmptyToolPermissionContext(),
      {
        activeAgents: [{ agentType: 'web-fetch', source: 'built-in' }],
      },
    )
    expect(next.map(t => t.name)).toContain(WEB_FETCH_TOOL_NAME)
    expect(next.map(t => t.name)).toContain('Agent')
    expect(next).not.toBe(pool)
  })

  test('GIe inserts before MCP / skill__ / later-sorted names', () => {
    process.env.CLAUDE_CODE_WEB_FETCH_AGENT = '1'
    delete process.env.CLAUDE_CODE_SIMPLE
    const pool = [
      tool('Zebra'),
      tool('Agent'),
      tool(`${SKILL_TOOL_NAME_PREFIX}demo`),
      tool('mcp__srv__t', { isMcp: true }),
    ]
    const next = admitWebFetchTool(
      { tools: ['WebFetch'] },
      pool as never,
      getEmptyToolPermissionContext(),
      {
        activeAgents: [{ agentType: 'web-fetch', source: 'built-in' }],
      },
    )
    expect(next[0]?.name).toBe(WEB_FETCH_TOOL_NAME)
  })

  test('_tm is empty when Cgr is off', () => {
    delete process.env.CLAUDE_CODE_WEB_FETCH_AGENT
    expect(
      webFetchHookBlockedHint(
        'Agent',
        { subagent_type: 'web-fetch' },
        [tool('Agent')] as never,
        getEmptyToolPermissionContext(),
        {
          activeAgents: [{ agentType: 'web-fetch', source: 'built-in' }],
        },
      ),
    ).toBe('')
  })

  test('_tm gold copy when hook blocks web-fetch and Cgr holds', () => {
    process.env.CLAUDE_CODE_WEB_FETCH_AGENT = '1'
    delete process.env.CLAUDE_CODE_SIMPLE
    const hint = webFetchHookBlockedHint(
      'Agent',
      { subagent_type: 'web-fetch' },
      [tool('Agent')] as never,
      getEmptyToolPermissionContext(),
      {
        activeAgents: [{ agentType: 'web-fetch', source: 'built-in' }],
      },
    )
    expect(hint).toContain(
      'Web pages can only be fetched through the web-fetch agent',
    )
    expect(hint).toContain('there is no direct WebFetch tool')
    expect(hint).toContain('tool_input.subagent_type == "web-fetch"')
  })

  test('call sites pass GIe fields', () => {
    const runAgent = readFileSync(join(__dirname, '..', 'runAgent.ts'), 'utf-8')
    const forked = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        'src',
        'utils',
        'forkedAgent.ts',
      ),
      'utf-8',
    )
    const toolExec = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        'src',
        'services',
        'tools',
        'toolExecution.ts',
      ),
      'utf-8',
    )
    expect(runAgent).toContain('webFetchReadmissionAllowed = true')
    expect(runAgent).toContain('admitWebFetchTool')
    expect(forked).toContain('webFetchReadmissionAllowed')
    expect(forked).toContain('admitWebFetchTool')
    expect(forked).toContain('filterWebFetchFromForkBase')
    expect(toolExec).toContain('webFetchHookBlockedHint')
  })
})
