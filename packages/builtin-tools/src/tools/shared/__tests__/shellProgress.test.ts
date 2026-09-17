import { describe, expect, test } from 'bun:test'
import type { ProgressMessage } from 'src/types/message.js'
import { findLastShellProgress } from '../shellProgress.js'

function tick(
  type: string,
  extra: Record<string, unknown> = {},
): ProgressMessage<unknown> {
  return {
    type: 'progress',
    data: { type, ...extra },
  } as unknown as ProgressMessage<unknown>
}

const bash = (output: string) =>
  tick('bash_progress', { output, fullOutput: output, elapsedTimeSeconds: 1 })
const powershell = (output: string) =>
  tick('powershell_progress', {
    output,
    fullOutput: output,
    elapsedTimeSeconds: 1,
  })
const hook = () =>
  tick('hook_progress', {
    hookEvent: 'PostToolUse',
    hookName: 'fmt',
    command: 'prettier',
  })

describe('findLastShellProgress', () => {
  test('skips a trailing hook tick sharing the shell call bucket', () => {
    // Hooks emit under the tool_use id they fire for, so they land in the same
    // parentToolUseID bucket as the shell ticks. Taking .at(-1) blindly handed
    // ShellProgressMessage a tick with no fullOutput → crash on .trim().
    const found = findLastShellProgress(
      [bash('one'), bash('two'), hook()],
      'bash_progress',
    )

    expect(
      (found?.data as { fullOutput: string } | undefined)?.fullOutput,
    ).toBe('two')
  })

  test('returns the most recent shell tick', () => {
    const found = findLastShellProgress(
      [bash('one'), hook(), bash('three')],
      'bash_progress',
    )

    expect(
      (found?.data as { fullOutput: string } | undefined)?.fullOutput,
    ).toBe('three')
  })

  test('returns undefined when only hook ticks have arrived', () => {
    expect(
      findLastShellProgress([hook(), hook()], 'bash_progress'),
    ).toBeUndefined()
  })

  test('does not cross shell backends', () => {
    expect(
      findLastShellProgress([powershell('ps')], 'bash_progress'),
    ).toBeUndefined()
    expect(
      findLastShellProgress([bash('sh')], 'powershell_progress'),
    ).toBeUndefined()
  })

  test('empty bucket yields undefined', () => {
    expect(findLastShellProgress([], 'bash_progress')).toBeUndefined()
  })

  test('tolerates ticks with no data', () => {
    const malformed = {
      type: 'progress',
    } as unknown as ProgressMessage<unknown>

    expect(
      findLastShellProgress([malformed, bash('ok')], 'bash_progress'),
    ).toBeDefined()
    expect(findLastShellProgress([malformed], 'bash_progress')).toBeUndefined()
  })
})
