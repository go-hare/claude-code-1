import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const spinnerSrc = readFileSync(
  join(import.meta.dir, '../../Spinner.tsx'),
  'utf8',
)

describe('densable 2.1.289 Cn Next: line', () => {
  test('st gates Next: and todo chrome to the main session', () => {
    expect(spinnerSrc).toContain(
      'agentId === undefined || agentId === getMainThreadAgentId()',
    )
    expect(spinnerSrc).toContain('isMainSession ? findNextPendingTask(tasksV2)')
    expect(spinnerSrc).not.toContain('export function ar(')
    expect(spinnerSrc).not.toContain('export function Ve(')
  })

  test('Next: trims subject and uses truncate-end', () => {
    expect(spinnerSrc).toContain(
      "`Next: ${opts.nextTaskSubject.replace(/\\s+/g, ' ').trim()}`",
    )
    expect(spinnerSrc).toContain("wrap={nextTask ? 'truncate-end' : 'wrap'}")
  })

  test('teammate tree is removed in 2.1.328 so Next: is never hidden by it', () => {
    expect(spinnerSrc).not.toContain('<TeammateSpinnerTree')
    expect(spinnerSrc).toContain(
      '{isMainSession && showExpandedTodos && tasksV2 && tasksV2.length > 0',
    )
  })
})
