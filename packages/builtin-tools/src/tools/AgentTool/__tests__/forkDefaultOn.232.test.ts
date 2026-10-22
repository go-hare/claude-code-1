import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  isForkSubagentProductEnabled,
  resetForkSubagentProductSource,
} from '../forkSubagent.js'
import {
  isForkSubagentEnabled,
  resetForkSubagentSessionSource,
  resolveForkSubagentSource,
} from 'src/utils/forkSubagentGate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * densable 2.1.232 #1 — subagent forking default ON (non-ant).
 *
 *   Drb: env true→env; ant→disabled; else→default
 *   _Ie: FDd()!=="disabled"
 *   run_in_background!==false already HAVE (agentBackgroundDefault tests)
 */
describe('fork default ON densable 232 #1', () => {
  afterEach(() => {
    resetForkSubagentSessionSource()
    resetForkSubagentProductSource()
  })

  test('FDd session sticky pins first live Drb (env flip later ignored)', () => {
    const saved = process.env.CLAUDE_CODE_FORK_SUBAGENT
    const savedUser = process.env.USER_TYPE
    resetForkSubagentSessionSource()
    delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    delete process.env.USER_TYPE
    expect(resolveForkSubagentSource()).toBe('default')
    process.env.CLAUDE_CODE_FORK_SUBAGENT = '1'
    expect(resolveForkSubagentSource()).toBe('default')
    resetForkSubagentSessionSource()
    expect(resolveForkSubagentSource()).toBe('env')
    if (saved === undefined) delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    else process.env.CLAUDE_CODE_FORK_SUBAGENT = saved
    if (savedUser === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = savedUser
    resetForkSubagentSessionSource()
  })

  test('FDd env false still disables in front of sticky', () => {
    const saved = process.env.CLAUDE_CODE_FORK_SUBAGENT
    resetForkSubagentSessionSource()
    delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    expect(resolveForkSubagentSource()).toBe('default')
    process.env.CLAUDE_CODE_FORK_SUBAGENT = '0'
    expect(resolveForkSubagentSource()).toBe('disabled')
    if (saved === undefined) delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    else process.env.CLAUDE_CODE_FORK_SUBAGENT = saved
    resetForkSubagentSessionSource()
  })

  test('gate default enables fork for non-ant', () => {
    expect(resolveForkSubagentSource({ env: {}, isAnt: false })).toBe('default')
    expect(isForkSubagentEnabled({ env: {}, isAnt: false })).toBe(true)
  })

  test('289 Imo ignores the 232 ant gate', () => {
    const src = readFileSync(join(__dirname, '..', 'forkSubagent.ts'), 'utf8')
    const start = src.indexOf('export function isForkSubagentProductEnabled')
    const end = src.indexOf('export function isForkSubagentScriptCallEnabled')
    const body = src.slice(start, end)
    expect(body).not.toContain('forkSubagentGate')
    expect(body).not.toContain('process.env.USER_TYPE')
    expect(body).not.toContain('isAnt')
    expect(body).toContain('isCoordinatorMode()')
    expect(body).toContain('getIsNonInteractiveSession()')
    expect(body).toContain('isEnvTruthy(process.env.CLAUDE_CODE_FORK_SUBAGENT)')
  })

  test('Omo sticky keeps env enable after the env is cleared; env false still wins', () => {
    const saved = process.env.CLAUDE_CODE_FORK_SUBAGENT
    resetForkSubagentProductSource()
    process.env.CLAUDE_CODE_FORK_SUBAGENT = '1'
    expect(isForkSubagentProductEnabled()).toBe(true)
    delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    expect(isForkSubagentProductEnabled()).toBe(true)
    process.env.CLAUDE_CODE_FORK_SUBAGENT = '0'
    expect(isForkSubagentProductEnabled()).toBe(false)
    if (saved === undefined) delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    else process.env.CLAUDE_CODE_FORK_SUBAGENT = saved
    resetForkSubagentProductSource()
  })

  test('explicit env true enables Yne for ant in a headless session', () => {
    const savedFork = process.env.CLAUDE_CODE_FORK_SUBAGENT
    const savedUser = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'
    delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    expect(isForkSubagentProductEnabled()).toBe(false)
    process.env.CLAUDE_CODE_FORK_SUBAGENT = '1'
    expect(isForkSubagentProductEnabled()).toBe(true)
    if (savedFork === undefined) delete process.env.CLAUDE_CODE_FORK_SUBAGENT
    else process.env.CLAUDE_CODE_FORK_SUBAGENT = savedFork
    if (savedUser === undefined) delete process.env.USER_TYPE
    else process.env.USER_TYPE = savedUser
  })

  test('bg-by-default still present (changelog half of #1)', () => {
    const agentTool = readFileSync(
      join(__dirname, '..', 'AgentTool.tsx'),
      'utf8',
    )
    expect(agentTool).toContain('(!h && run_in_background !== false)')
    expect(agentTool).toContain('(!isWebFetchSpawn && b)')
  })

  test('fork is explicit subagent_type fork, never omit-type default', () => {
    const agentTool = readFileSync(
      join(__dirname, '..', 'AgentTool.tsx'),
      'utf8',
    )
    expect(agentTool).toContain('isExplicitFork')
    expect(agentTool).toContain('FORK_SUBAGENT_TYPE')
    expect(agentTool).not.toContain(
      'subagent_type ?? (isForkSubagentEnabled() ? undefined : GENERAL_PURPOSE_AGENT.agentType)',
    )
  })
})
