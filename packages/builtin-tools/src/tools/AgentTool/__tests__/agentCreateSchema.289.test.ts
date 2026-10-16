import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, '..', 'AgentTool.tsx'), 'utf-8')

describe('densable 2.1.289 Agent create schema', () => {
  test('name second refine is gold uO reserved + agent-id shape', () => {
    expect(src).toContain('isReservedSpawnAgentName')
    expect(src).toContain(
      'name must not be a reserved name ("main", "team-lead", "user" or "system", in any spelling) or have the shape of an agent id',
    )
  })

  test('model describe mentions default subagent model and coordinator omit', () => {
    expect(src).toContain('configured default subagent model')
    expect(src).toContain(
      'Set this only when EXPLICITLY asked by the user for a specific model',
    )
  })

  test('output union has worktreePath, async extras, remote_launched', () => {
    expect(src).toContain('worktreePath: z.string().optional()')
    expect(src).toContain('worktreeBranch: z.string().optional()')
    expect(src).toContain('isAsync: z.literal(true).optional()')
    expect(src).toContain('resolvedModel:')
    expect(src).toContain('modelsUsed:')
    expect(src).toContain('sharesCwd:')
    expect(src).toContain("status: z.literal('remote_launched')")
    expect(src).toContain(
      'return z.union([syncOutputSchema, asyncOutputSchema, remoteOutputSchema])',
    )
  })

  test('async_launched returns stamp resolvedModel', () => {
    expect(src).toContain('resolvedModel: resolvedAgentModel')
    expect(src).toContain('modelsUsed: [resolvedAgentModel]')
  })

  test('async_launched stamps sharesCwd from ALo&&TRe', () => {
    expect(src).toContain('resolveSharesCwdStamp')
    expect(src).toContain('...(sharesCwd ? { sharesCwd: true as const } : {})')
    expect(src).toContain('SHARES_CWD_LAUNCH_NOTE')
  })

  test('create schema has no task_id or owned_files (gold 2.1.289 cut)', () => {
    expect(src).not.toMatch(/\btask_id\b/)
    expect(src).not.toMatch(/\bowned_files\b/)
    expect(src).not.toContain('taskLinkingWarning')
    expect(src).not.toContain('taskLinking.js')
    expect(src).not.toContain('shouldExposeTaskIdInput')
    expect(src).not.toContain('normalizeAgentOwnedFiles')
    expect(src).not.toContain('resolveAgentTaskExecutionContext')
  })
})
