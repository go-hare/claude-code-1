/**
 * densable 2.1.289 COMMENT_ANALYST_AGENT @210596735 + DTe (yvt) omit.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  COMMENT_ANALYST_AGENT,
  COMMENT_ANALYST_AGENT_TYPE,
  COMMENT_ANALYST_BRIEF_HEADER,
} from '../built-in/commentThreadAnalyst.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const builtInSource = readFileSync(
  join(__dirname, '..', 'builtInAgents.ts'),
  'utf-8',
)

describe('densable 2.1.289 comment-thread-analyst', () => {
  test('COMMENT_ANALYST_AGENT matches gold @210596735', () => {
    expect(COMMENT_ANALYST_AGENT_TYPE).toBe('comment-thread-analyst')
    expect(COMMENT_ANALYST_BRIEF_HEADER).toBe('ANALYSIS BRIEF')
    expect(COMMENT_ANALYST_AGENT.agentType).toBe(COMMENT_ANALYST_AGENT_TYPE)
    expect(COMMENT_ANALYST_AGENT.source).toBe('built-in')
    expect(COMMENT_ANALYST_AGENT.baseDir).toBe('built-in')
    expect(COMMENT_ANALYST_AGENT.model).toBe('inherit')
    expect(COMMENT_ANALYST_AGENT.maxTurns).toBe(6)
    expect(COMMENT_ANALYST_AGENT.omitClaudeMd).toBe(true)
    expect(COMMENT_ANALYST_AGENT.tools).toEqual(['Artifact'])
    expect(COMMENT_ANALYST_AGENT.whenToUse).toContain(
      'not intended for direct spawning',
    )
    const prompt = COMMENT_ANALYST_AGENT.getSystemPrompt({} as never)
    expect(prompt).toContain('You are an artifact comment-thread analyst')
    expect(prompt).toContain('ANALYSIS BRIEF')
    expect(prompt).toContain('thread_id')
    expect(prompt).toContain('read_page_data')
  })

  test('yvt / DTe does not list COMMENT_ANALYST_AGENT (Ur dynamic-imports it)', () => {
    expect(builtInSource).not.toContain("from './built-in/commentThreadAnalyst")
    expect(builtInSource).not.toContain('agents.push(COMMENT_ANALYST_AGENT)')
    const roster = builtInSource.slice(
      builtInSource.indexOf('const agents: AgentDefinition[]'),
      builtInSource.indexOf('if (areExplorePlanAgentsEnabled())'),
    )
    expect(roster).toContain('GENERAL_PURPOSE_AGENT')
    expect(roster).not.toContain('commentThreadAnalyst')
    // densable DTe: if(!Sr()) n.push(AIt) — statusline omitted in safe mode.
    expect(roster).toContain('isSafeModeEnabled')
    expect(roster).toContain('STATUSLINE_SETUP_AGENT')
  })
})
