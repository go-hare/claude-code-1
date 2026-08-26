/**
 * densable 2.1.239 leftover — built-in web-fetch agent (lN / bpr / WIe / Iq).
 * Source-lock + WIe / _pr unit tests. GIe / raw wrap live in sibling 239 files.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  FETCHED_WEB_CONTENT_TAG,
  isBuiltInWebFetchAgent,
  isWebFetchAgentRuntimeContext,
  isWebFetchAgentTypeName,
  shouldSkipTeammateSpawnForWebFetch,
  WEB_FETCH_AGENT,
  WEB_FETCH_AGENT_TYPE,
} from '../built-in/webFetchAgent.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const builtInSource = readFileSync(
  join(__dirname, '..', 'builtInAgents.ts'),
  'utf-8',
)
const agentToolSource = readFileSync(
  join(__dirname, '..', 'AgentTool.tsx'),
  'utf-8',
)
const isolationSource = readFileSync(
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
    'agentIsolationRemote.ts',
  ),
  'utf-8',
)

describe('densable 2.1.239 web-fetch agent leftover', () => {
  test('bpr fields match official', () => {
    expect(WEB_FETCH_AGENT_TYPE).toBe('web-fetch')
    expect(FETCHED_WEB_CONTENT_TAG).toBe('fetched-web-content')
    expect(WEB_FETCH_AGENT.agentType).toBe('web-fetch')
    expect(WEB_FETCH_AGENT.source).toBe('built-in')
    expect(WEB_FETCH_AGENT.baseDir).toBe('built-in')
    expect(WEB_FETCH_AGENT.model).toBe('inherit')
    expect(WEB_FETCH_AGENT.color).toBe('blue')
    expect(WEB_FETCH_AGENT.omitClaudeMd).toBe(true)
    expect(WEB_FETCH_AGENT.tools).toEqual(['WebFetch'])
    expect(WEB_FETCH_AGENT.whenToUse).toContain(
      'when you do not have a direct WebFetch tool of your own',
    )
    expect(WEB_FETCH_AGENT.whenToUse).toContain('`tool-results`')
    expect(WEB_FETCH_AGENT.whenToUse).toContain('via SendMessage')
    expect(WEB_FETCH_AGENT.getSystemPrompt({} as never)).toContain(
      '<fetched-web-content>',
    )
  })

  test('yvt registers bpr after explore/plan via aAi', () => {
    expect(builtInSource).toContain('isWebFetchAgentEnabled()')
    expect(builtInSource).toContain('agents.push(WEB_FETCH_AGENT)')
  })

  test('call uses WIe skip + Tno isolation resolve', () => {
    expect(agentToolSource).toContain('shouldSkipTeammateSpawnForWebFetch')
    expect(agentToolSource).toContain('resolveEffectiveIsolation')
    expect(agentToolSource).toContain('availability is gated')
    expect(agentToolSource).toContain('Cannot launch cloud agent:')
    expect(agentToolSource).toContain('subagent_remote_ineligible')
    expect(agentToolSource).not.toContain(
      "process.env.USER_TYPE === 'ant' ? z.enum(['worktree', 'remote'])",
    )
  })

  test('Tno / Gji gold strings are in the isolation helper', () => {
    expect(isolationSource).toContain('tengu_neapolitan')
    expect(isolationSource).toContain(
      'Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured.',
    )
    expect(isolationSource).toContain(
      'the built-in web-fetch agent always runs as a local agent',
    )
  })

  test('WIe: no roster / missing built-in → false', () => {
    expect(shouldSkipTeammateSpawnForWebFetch('web-fetch', undefined)).toBe(
      false,
    )
    expect(shouldSkipTeammateSpawnForWebFetch('web-fetch', [])).toBe(false)
    expect(
      shouldSkipTeammateSpawnForWebFetch('web-fetch', [
        { agentType: 'web-fetch', source: 'user' },
      ]),
    ).toBe(false)
  })

  test('WIe: built-in web-fetch skips teammate spawn', () => {
    const roster = [
      { agentType: 'general-purpose', source: 'built-in' },
      { agentType: 'web-fetch', source: 'built-in' },
    ]
    expect(shouldSkipTeammateSpawnForWebFetch('web-fetch', roster)).toBe(true)
    expect(shouldSkipTeammateSpawnForWebFetch('Web-Fetch', roster)).toBe(true)
    expect(shouldSkipTeammateSpawnForWebFetch(undefined, roster)).toBe(false)
    expect(shouldSkipTeammateSpawnForWebFetch('Explore', roster)).toBe(false)
  })

  test('_pr is built-in web-fetch subagent only', () => {
    expect(
      isWebFetchAgentRuntimeContext({
        agentType: 'subagent',
        isBuiltIn: true,
        subagentName: 'web-fetch',
      }),
    ).toBe(true)
    expect(
      isWebFetchAgentRuntimeContext({
        agentType: 'subagent',
        isBuiltIn: false,
        subagentName: 'web-fetch',
      }),
    ).toBe(false)
    expect(
      isWebFetchAgentRuntimeContext({
        agentType: 'subagent',
        isBuiltIn: true,
        subagentName: 'Explore',
      }),
    ).toBe(false)
  })

  test('h9n / Iq', () => {
    expect(isWebFetchAgentTypeName('web_fetch')).toBe(true)
    expect(isWebFetchAgentTypeName('Explore')).toBe(false)
    expect(
      isBuiltInWebFetchAgent({ agentType: 'web-fetch', source: 'built-in' }),
    ).toBe(true)
    expect(
      isBuiltInWebFetchAgent({ agentType: 'web-fetch', source: 'user' }),
    ).toBe(false)
  })
})
