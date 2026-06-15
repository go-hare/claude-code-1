import { describe, expect, test } from 'bun:test'
import { buildPtyHostSpawnArgs } from '../bgWorker'

describe('buildPtyHostSpawnArgs', () => {
  test('keeps script path in dev mode', () => {
    const args = buildPtyHostSpawnArgs(
      'C:\\Users\\me\\.bun\\bin\\bun.exe',
      ['src/entrypoints/cli.tsx', '--session-id', 'abc', '--resume', 'def'],
      {
        cols: 120,
        rows: 40,
        ptySock: 'pty.sock',
        runtimeFlags: ['-d', 'MACRO.VERSION:"test"'],
        bundled: false,
      },
    )

    expect(args).toEqual([
      'C:\\Users\\me\\.bun\\bin\\bun.exe',
      '-d',
      'MACRO.VERSION:"test"',
      'src/entrypoints/cli.tsx',
      '--bg-pty-host',
      'pty.sock',
      '120',
      '40',
      '--',
      'C:\\Users\\me\\.bun\\bin\\bun.exe',
      '-d',
      'MACRO.VERSION:"test"',
      'src/entrypoints/cli.tsx',
      '--session-id',
      'abc',
      '--resume',
      'def',
    ])
  })

  test('does not drop the first CLI arg in bundled mode', () => {
    const args = buildPtyHostSpawnArgs(
      'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@go-hare\\claude-code\\bin\\claude.exe',
      ['--session-id', 'abc', '--resume', 'def'],
      {
        cols: 120,
        rows: 40,
        ptySock: 'pty.sock',
        bundled: true,
      },
    )

    expect(args).toEqual([
      'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@go-hare\\claude-code\\bin\\claude.exe',
      '--bg-pty-host',
      'pty.sock',
      '120',
      '40',
      '--',
      'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@go-hare\\claude-code\\bin\\claude.exe',
      '--session-id',
      'abc',
      '--resume',
      'def',
    ])
  })
})
