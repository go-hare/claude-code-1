import { afterEach, describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import {
  buildStartupFailureResult,
  MANAGED_SETTINGS_INVALID_REASON,
  remapStartupFailureSessionId,
  shouldWriteStartupFailureResult,
  writeStartupFailureResult,
} from '../startupFailure.js'

describe('D6 startup failure stream-json gate densable 2.1.283', () => {
  const prev = process.env.CLAUDE_CODE_STARTUP_FAILURE_RESULTS

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.CLAUDE_CODE_STARTUP_FAILURE_RESULTS
    } else {
      process.env.CLAUDE_CODE_STARTUP_FAILURE_RESULTS = prev
    }
  })

  const printArgv = ['node', 'claude', '-p', '--output-format=stream-json']

  test('env unset → no JSON even with --output-format=stream-json', async () => {
    delete process.env.CLAUDE_CODE_STARTUP_FAILURE_RESULTS
    expect(shouldWriteStartupFailureResult({}, printArgv, false)).toBe(false)
    const chunks: Buffer[] = []
    const stdout = new PassThrough()
    stdout.on('data', c => chunks.push(Buffer.from(c)))
    await writeStartupFailureResult(
      {
        sessionId: 'sess-1',
        message: 'blocked',
        reason: MANAGED_SETTINGS_INVALID_REASON,
      },
      {
        env: {},
        argv: printArgv,
        stdout: stdout as unknown as NodeJS.WriteStream,
      },
    )
    expect(Buffer.concat(chunks).toString()).toBe('')
  })

  test('env + stream-json + Dhn → gold O6/dmt envelope', async () => {
    const env = { CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1' }
    expect(shouldWriteStartupFailureResult(env, printArgv, false)).toBe(true)
    const chunks: Buffer[] = []
    const stdout = new PassThrough()
    stdout.on('data', c => chunks.push(Buffer.from(c)))
    const input = {
      sessionId: 'sess-1',
      message: "Claude Code can't start",
      reason: MANAGED_SETTINGS_INVALID_REASON,
    } as const
    await writeStartupFailureResult(input, {
      env,
      argv: printArgv,
      stdout: stdout as unknown as NodeJS.WriteStream,
    })
    const line = Buffer.concat(chunks).toString()
    expect(line.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(parsed.type).toBe('result')
    expect(parsed.subtype).toBe('error_during_execution')
    expect(parsed.is_error).toBe(true)
    expect(parsed.session_id).toBe('sess-1')
    expect(parsed.errors).toEqual(["Claude Code can't start"])
    expect(parsed.startup_failure_reason).toBe('managed_settings_invalid')
    expect(parsed.result_index).toBe(0)
    expect(parsed.duration_ms).toBe(0)
    const rebuilt = buildStartupFailureResult(input)
    expect(parsed.subtype).toBe(rebuilt.subtype)
    expect(parsed.session_id).toBe(rebuilt.session_id)
  })

  test('env + --output-format stream-json (space form) + -p → gated on', async () => {
    const env = { CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1' }
    expect(
      shouldWriteStartupFailureResult(
        env,
        ['node', 'claude', '-p', '--output-format', 'stream-json'],
        false,
      ),
    ).toBe(true)
  })

  test('env + --output-format=json → no JSON', () => {
    expect(
      shouldWriteStartupFailureResult(
        { CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1' },
        ['node', 'claude', '-p', '--output-format=json'],
        false,
      ),
    ).toBe(false)
  })

  test('TTY without -p → $9n false even with stream-json', () => {
    expect(
      shouldWriteStartupFailureResult(
        { CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1' },
        ['node', 'claude', '--output-format=stream-json'],
        true,
      ),
    ).toBe(false)
  })

  test('gold d(): --session-id UUID remaps envelope session_id', async () => {
    const env = { CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1' }
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const argv = [
      'node',
      'claude',
      '-p',
      '--output-format=stream-json',
      '--session-id',
      uuid,
    ]
    expect(remapStartupFailureSessionId('sess-fallback', argv)).toBe(uuid)
    const chunks: Buffer[] = []
    const stdout = new PassThrough()
    stdout.on('data', c => chunks.push(Buffer.from(c)))
    await writeStartupFailureResult(
      {
        sessionId: 'sess-fallback',
        message: 'blocked',
        reason: MANAGED_SETTINGS_INVALID_REASON,
      },
      {
        env,
        argv,
        stdout: stdout as unknown as NodeJS.WriteStream,
      },
    )
    const parsed = JSON.parse(Buffer.concat(chunks).toString()) as Record<
      string,
      unknown
    >
    expect(parsed.session_id).toBe(uuid)
    expect(parsed.subtype).toBe('error_during_execution')
  })

  test('gold d(): invalid --session-id without --sdk-url keeps fallback (en)', () => {
    expect(
      remapStartupFailureSessionId('sess-fallback', [
        'node',
        'claude',
        '--session-id',
        'not-a-uuid',
      ]),
    ).toBe('sess-fallback')
  })

  test('gold d(): --sdk-url skips en() so raw --session-id wins', () => {
    expect(
      remapStartupFailureSessionId('sess-fallback', [
        'node',
        'claude',
        '--sdk-url',
        'ws://127.0.0.1:1',
        '--session-id',
        'not-a-uuid',
      ]),
    ).toBe('not-a-uuid')
  })

  test('writableEnded skips write', async () => {
    const chunks: Buffer[] = []
    const stdout = new PassThrough()
    stdout.on('data', c => chunks.push(Buffer.from(c)))
    stdout.end()
    await writeStartupFailureResult(
      {
        sessionId: 'sess-1',
        message: 'blocked',
        reason: MANAGED_SETTINGS_INVALID_REASON,
      },
      {
        env: { CLAUDE_CODE_STARTUP_FAILURE_RESULTS: '1' },
        argv: printArgv,
        stdout: stdout as unknown as NodeJS.WriteStream,
      },
    )
    expect(Buffer.concat(chunks).toString()).toBe('')
  })
})
