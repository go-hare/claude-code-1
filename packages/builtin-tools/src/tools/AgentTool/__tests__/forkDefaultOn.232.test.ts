import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
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

  test('AgentTool isForkSubagentEnabled ORs portable gate (not compile-only)', () => {
    const src = readFileSync(join(__dirname, '..', 'forkSubagent.ts'), 'utf8')
    expect(src).toContain("require('src/utils/forkSubagentGate.js')")
    expect(src).toContain('isForkSubagentEnabled()')
    // Yne folds coordinator; Ce (non-interactive) is only on isForkSubagentEnabled
    expect(src).toContain('isForkSubagentProductEnabled')
    expect(src).toContain('isCoordinatorMode()')
    expect(src).toContain('getIsNonInteractiveSession()')
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
