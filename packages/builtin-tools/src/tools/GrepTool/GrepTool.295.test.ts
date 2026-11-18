import { describe, expect, mock, test } from 'bun:test'

mock.module('src/utils/ShellCommand.js', () => ({
  ShellCommand: class {},
  killProcessTree: () => {},
  wrapSpawn: (fn: unknown) => fn,
  createAbortedCommand: () => ({}),
  createFailedCommand: (err: string) => ({ preSpawnError: err }),
  createAdoptedShellCommand: () => ({}),
}))

mock.module('../GlobTool/UI.js', () => ({
  userFacingName: () => 'Glob',
  getToolUseSummary: () => '',
  renderToolUseMessage: () => null,
  renderToolUseErrorMessage: () => null,
  renderToolResultMessage: () => null,
}))

mock.module('./UI.js', () => ({
  getToolUseSummary: () => '',
  renderToolResultMessage: () => null,
  renderToolUseErrorMessage: () => null,
  renderToolUseMessage: () => null,
}))

const { coerceGrepInput } = await import('./GrepTool.js')

describe('2.1.292-2.1.295 GrepTool alignment', () => {
  test('#256 coerceGrepInput maps file_path to path and ignores repeated file_path', () => {
    const res1 = coerceGrepInput({
      pattern: 'foo',
      file_path: '/tmp/dir',
    })
    expect(res1?.input).toEqual({ pattern: 'foo', path: '/tmp/dir' })
    expect(res1?.shapeClass).toBe('file_path')
    expect(res1?.resultNote).toContain('`file_path` was read as `path`.')

    const res2 = coerceGrepInput({
      pattern: 'foo',
      path: '/tmp/dir',
      file_path: '/tmp/dir',
    })
    expect(res2?.input).toEqual({ pattern: 'foo', path: '/tmp/dir' })
    expect(res2?.shapeClass).toBe('repeated_file_path')
    expect(res2?.resultNote).toContain(
      '`file_path` repeated `path` and was ignored.',
    )
  })

  test('#450 coerceGrepInput maps -l, -c, and ignores -r', () => {
    const resL = coerceGrepInput({ pattern: 'foo', '-l': true, '-r': true })
    expect(resL?.input).toEqual({
      pattern: 'foo',
      output_mode: 'files_with_matches',
    })
    expect(resL?.shapeClass).toBe('flag_l,flag_r')
    expect(resL?.resultNote).toContain('`output_mode: "files_with_matches"`')
    expect(resL?.resultNote).toContain('`-r` was ignored')

    const resC = coerceGrepInput({ pattern: 'foo', '-c': 'true' })
    expect(resC?.input).toEqual({
      pattern: 'foo',
      output_mode: 'count',
    })
    expect(resC?.shapeClass).toBe('flag_c')
  })
})
