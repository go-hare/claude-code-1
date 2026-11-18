import { describe, expect, test } from 'bun:test'
import { execFileNoThrowWithCwd, formatSpawnError } from '../execFileNoThrow.js'

describe('v2.1.290 #123 execFileNoThrow spawn error normalization', () => {
  test('formatSpawnError surfaces errno spawn error when result lacks exitCode and code', () => {
    const formatted = formatSpawnError(
      {
        exitCode: undefined,
        timedOut: false,
        isCanceled: false,
        command: 'nonexistent-bin --version',
      },
      {
        errno: -2,
        code: 'ENOENT',
        syscall: 'spawn nonexistent-bin',
        message: 'spawn nonexistent-bin ENOENT',
      },
    )
    expect(formatted).toBe(
      'Command failed with ENOENT: nonexistent-bin --version\nspawn nonexistent-bin ENOENT',
    )
  })

  test('formatSpawnError returns undefined when exitCode is set or result.code matches', () => {
    expect(
      formatSpawnError(
        { exitCode: 1, command: 'git status' },
        { errno: -2, code: 'ENOENT', syscall: 'spawn git', message: 'enoent' },
      ),
    ).toBeUndefined()
    expect(
      formatSpawnError(
        { code: 'ENOENT', command: 'git status' },
        { errno: -2, code: 'ENOENT', syscall: 'spawn git', message: 'enoent' },
      ),
    ).toBeUndefined()
  })

  test('execFileNoThrowWithCwd includes ENOENT in error for missing executable', async () => {
    const res = await execFileNoThrowWithCwd(
      'definitely-nonexistent-binary-xyz-290',
      ['--version'],
    )
    expect(res.code).not.toBe(0)
    expect(res.error).toContain('ENOENT')
  })
})
