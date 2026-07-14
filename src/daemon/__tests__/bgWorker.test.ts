import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildPtyHostSpawnArgs,
  buildWorkerEnv,
  type DispatchRequest,
} from '../bgWorker'

function makeDispatch(
  mode: DispatchRequest['launch']['mode'],
): DispatchRequest {
  return {
    short: 'abcd',
    sessionId: 'sess',
    intent: 'test',
    cwd: process.cwd(),
    respawnFlags: [],
    source: 'test',
    createdAt: Date.now(),
    launch: { mode },
  }
}

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

describe('buildWorkerEnv exec EXTRA_BODY (2.1.206)', () => {
  const prevBody = process.env.CLAUDE_CODE_EXTRA_BODY
  const prevMeta = process.env.CLAUDE_CODE_EXTRA_METADATA

  afterEach(() => {
    if (prevBody === undefined) delete process.env.CLAUDE_CODE_EXTRA_BODY
    else process.env.CLAUDE_CODE_EXTRA_BODY = prevBody
    if (prevMeta === undefined) delete process.env.CLAUDE_CODE_EXTRA_METADATA
    else process.env.CLAUDE_CODE_EXTRA_METADATA = prevMeta
  })

  test('preserves CLAUDE_CODE_EXTRA_BODY through exec strip', () => {
    process.env.CLAUDE_CODE_EXTRA_BODY = '{"region":"us"}'
    process.env.CLAUDE_CODE_EXTRA_METADATA = '{"team":"x"}'
    const env = buildWorkerEnv(
      makeDispatch('exec'),
      '/tmp/job-dir',
      undefined,
      '/tmp/rv.sock',
    )
    expect(env.CLAUDE_CODE_EXTRA_BODY).toBe('{"region":"us"}')
    expect(env.CLAUDE_CODE_EXTRA_METADATA).toBe('{"team":"x"}')
    expect(env.CLAUDE_PTY_HOST_EXEC).toBe('1')
    // Other CLAUDE_ session vars are still stripped in exec mode
    expect(env.CLAUDE_CODE_SESSION_KIND).toBeUndefined()
    expect(env.CLAUDE_JOB_DIR).toBe('/tmp/job-dir')
  })
})
