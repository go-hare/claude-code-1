import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildBridgeReattachEnv,
  buildPtyHostSpawnArgs,
  buildWorkerArgs,
  buildWorkerEnv,
  shellExecSpec,
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

describe('buildBridgeReattachEnv densable rit()', () => {
  test('mirrors rit(session, seq, outboundOnly, grouping)', () => {
    expect(buildBridgeReattachEnv(undefined)).toBeUndefined()
    expect(buildBridgeReattachEnv('sid')).toEqual({
      CLAUDE_BRIDGE_REATTACH_SESSION: 'sid',
      CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY: '1',
    })
    expect(buildBridgeReattachEnv('sid', 7, false, 'sgrp_x')).toEqual({
      CLAUDE_BRIDGE_REATTACH_SESSION: 'sid',
      CLAUDE_BRIDGE_REATTACH_SEQ: '7',
      CLAUDE_BRIDGE_REATTACH_GROUPING: 'sgrp_x',
    })
    expect(buildBridgeReattachEnv('sid', 0, true, 'g')).toEqual({
      CLAUDE_BRIDGE_REATTACH_SESSION: 'sid',
      CLAUDE_BRIDGE_REATTACH_GROUPING: 'g',
      CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY: '1',
    })
    expect(
      buildBridgeReattachEnv('sid', 3, true, 'g', {
        ownerAccountUuid: 'a',
        ownerOrganizationUuid: 'o',
        noHistoryBackfill: true,
      }),
    ).toEqual({
      CLAUDE_BRIDGE_REATTACH_SESSION: 'sid',
      CLAUDE_BRIDGE_REATTACH_SEQ: '3',
      CLAUDE_BRIDGE_REATTACH_GROUPING: 'g',
      CLAUDE_BRIDGE_REATTACH_OWNER_ACCT: 'a',
      CLAUDE_BRIDGE_REATTACH_OWNER_ORG: 'o',
      CLAUDE_BRIDGE_REATTACH_NO_BACKFILL: '1',
      CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY: '1',
    })
  })
})

describe('shellExecSpec densable $F_', () => {
  const prevShell = process.env.SHELL
  const prevComspec = process.env.COMSPEC

  afterEach(() => {
    if (prevShell === undefined) delete process.env.SHELL
    else process.env.SHELL = prevShell
    if (prevComspec === undefined) delete process.env.COMSPEC
    else process.env.COMSPEC = prevComspec
  })

  test('uses SHELL -c when SHELL is set', () => {
    process.env.SHELL = '/bin/zsh'
    expect(shellExecSpec('echo hi')).toEqual({
      cmd: '/bin/zsh',
      args: ['-c', 'echo hi'],
    })
  })

  test('falls back to /bin/sh -c when SHELL unset (non-win)', () => {
    delete process.env.SHELL
    if (process.platform === 'win32') {
      // On Windows without SHELL densable uses COMSPEC /c
      process.env.COMSPEC = 'C:\\Windows\\System32\\cmd.exe'
      expect(shellExecSpec('dir')).toEqual({
        cmd: 'C:\\Windows\\System32\\cmd.exe',
        args: ['/d', '/s', '/c', 'dir'],
      })
      return
    }
    expect(shellExecSpec('true')).toEqual({
      cmd: '/bin/sh',
      args: ['-c', 'true'],
    })
  })

  test('buildWorkerArgs returns launch.args for exec mode', () => {
    process.env.SHELL = '/bin/bash'
    const spec = shellExecSpec('sleep 1')
    const args = buildWorkerArgs(makeDispatch('exec'), 1, false, 'sess', [])
    // makeDispatch only sets mode — without args, returns []
    expect(args).toEqual([])

    const withArgs: DispatchRequest = {
      ...makeDispatch('exec'),
      launch: { mode: 'exec', cmd: spec.cmd, args: spec.args },
    }
    expect(buildWorkerArgs(withArgs, 1, false, 'sess', [])).toEqual([
      '-c',
      'sleep 1',
    ])
  })
})
