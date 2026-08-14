import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  isForkSubagentEnabled,
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
  test('gate default enables fork for non-ant', () => {
    expect(resolveForkSubagentSource({ env: {}, isAnt: false })).toBe('default')
    expect(isForkSubagentEnabled({ env: {}, isAnt: false })).toBe(true)
  })

  test('AgentTool isForkSubagentEnabled ORs portable gate (not compile-only)', () => {
    const src = readFileSync(join(__dirname, '..', 'forkSubagent.ts'), 'utf8')
    expect(src).toContain("require('src/utils/forkSubagentGate.js')")
    expect(src).toContain('isForkSubagentEnabled()')
    // session constraints still apply after enable
    expect(src).toContain('isCoordinatorMode()')
    expect(src).toContain('getIsNonInteractiveSession()')
  })

  test('bg-by-default still present (changelog half of #1)', () => {
    const agentTool = readFileSync(
      join(__dirname, '..', 'AgentTool.tsx'),
      'utf8',
    )
    expect(agentTool).toContain(
      '(!isInProcessTeammate() && run_in_background !== false)',
    )
  })
})
