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
      'agentId === undefined || agentId === getSessionId()',
    )
    expect(spinnerSrc).toContain('isMainSession ? findNextPendingTask(tasksV2)')
    expect(spinnerSrc).not.toContain('export function ar(')
    expect(spinnerSrc).not.toContain('export function Ve(')
  })

  test('Next: trims subject and uses truncate-end', () => {
    expect(spinnerSrc).toContain(
      "`Next: ${nextTask.subject.replace(/\\s+/g, ' ').trim()}`",
    )
    expect(spinnerSrc).toContain("wrap={nextTask ? 'truncate-end' : 'wrap'}")
  })

  test('teammate tree does not XOR Next: away', () => {
    expect(spinnerSrc).toContain('{showSpinnerTree && hasRunningTeammates ? (')
    expect(spinnerSrc).toContain(
      ') : null}\n      {isMainSession && showExpandedTodos && tasksV2 && tasksV2.length > 0',
    )
    // The XOR that hid Next: was `tree ? tree : showExpandedTodos ? list : nextTask`.
    expect(spinnerSrc).not.toMatch(
      /showSpinnerTree && hasRunningTeammates \? \(\s*<TeammateSpinnerTree[\s\S]*?\) : showExpandedTodos/,
    )
  })
})
