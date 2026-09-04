import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

describe('tasks 243 model+effort', () => {
  test('AsyncAgentDetailDialog subtitle shows model and effort', () => {
    const src = readFileSync(
      join(import.meta.dir, '../AsyncAgentDetailDialog.tsx'),
      'utf8',
    )
    expect(src).toContain('{agent.model && <> · {agent.model}</>}')
    expect(src).toContain('{agent.effort && <> · {agent.effort}</>}')
  })

  test('BackgroundTask local_agent row shows model and effort', () => {
    const src = readFileSync(
      join(import.meta.dir, '../BackgroundTask.tsx'),
      'utf8',
    )
    expect(src).toContain('task.model ?')
    expect(src).toContain('task.effort ?')
  })
})
