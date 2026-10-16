/**
 * densable 2.1.289 Arm A — gold Ct (`innerCall`) on ToolUseContext and
 * AgentTool headless formula `!toolUseContext.innerCall`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.289 innerCall / headless Ht', () => {
  test('source-locks AgentTool !toolUseContext.innerCall arm', () => {
    const src = readFileSync(join(__dirname, '..', 'AgentTool.tsx'), 'utf8')
    expect(src).toContain('!toolUseContext.innerCall')
    expect(src).toContain('callerIsHeadlessSubagent')
  })

  test('source-locks Tool.ts innerCall?: boolean (densable Ct)', () => {
    const toolTs = readFileSync(
      join(__dirname, '../../../../../../src/Tool.ts'),
      'utf8',
    )
    expect(toolTs).toContain('innerCall?: boolean')
    expect(toolTs).toMatch(/densable 2\.1\.289 gold `Ct`/)
  })

  test('innerCall true falsifies headless formula even with agentId + nonInteractive', () => {
    // Mirror gold: Ht = Yne() && agentId!==undefined && !Ct && !teammate && Ce()
    const forkProductEnabled = true
    const agentId: string | undefined = 'agent-1'
    const innerCall = true
    const callerIsInProcessTeammate = false
    const getIsNonInteractiveSession = true
    const callerIsHeadlessSubagent =
      forkProductEnabled &&
      agentId !== undefined &&
      !innerCall &&
      !callerIsInProcessTeammate &&
      getIsNonInteractiveSession
    expect(callerIsHeadlessSubagent).toBe(false)
  })

  test('Ht uses Yne (product fork) not session isForkSubagentEnabled which folds Ce', () => {
    const src = readFileSync(join(__dirname, '..', 'AgentTool.tsx'), 'utf8')
    expect(src).toContain('isForkSubagentProductEnabled')
    expect(src).toContain(
      'const forkProductEnabled = isForkSubagentProductEnabled()',
    )
    expect(src).toContain(
      'const forceAsync = forkProductEnabled && !callerIsInProcessTeammate && !callerIsHeadlessSubagent',
    )
    const htBlock = src.slice(
      src.indexOf('const callerIsHeadlessSubagent'),
      src.indexOf('const forceAsync'),
    )
    expect(htBlock).toContain('forkProductEnabled &&')
    expect(htBlock).not.toContain('isForkSubagentEnabled()')
  })
})
