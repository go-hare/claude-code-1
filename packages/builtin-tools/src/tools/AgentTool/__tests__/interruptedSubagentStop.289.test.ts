import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const runAgentSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'runAgent.ts'),
  'utf-8',
)

describe('runAgent SubagentStop on interrupt', () => {
  test('finally fires SubagentStop only when the query did not finish', () => {
    expect(runAgentSource).toContain('let queryCompleted = false')
    const completedAt = runAgentSource.indexOf('queryCompleted = true')
    const abortThrow = runAgentSource.indexOf('throw new AbortError()')
    const finallyAt = runAgentSource.indexOf('} finally {')
    expect(abortThrow).toBeGreaterThan(0)
    expect(completedAt).toBeGreaterThan(abortThrow)
    expect(finallyAt).toBeGreaterThan(completedAt)
    const stage = runAgentSource.slice(
      finallyAt,
      runAgentSource.indexOf('await mcpCleanup()', finallyAt),
    )
    expect(stage).toContain('if (!queryCompleted)')
    expect(stage).toContain('executeStopHooks(')
    expect(stage).toContain('5000')
    expect(stage).toContain(
      '[runAgent] SubagentStop on interrupted query failed:',
    )
  })
})
