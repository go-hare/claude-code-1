/**
 * densable 2.1.248 #27 Pmr @189642272 sha=90e236fb25f3e1ac —
 * claude logs replays streamTail via tr, writes via ov, exits via Pi(0).
 * No cleanupTerminalModes inside Pmr. Nj is not a logs-exit caller.
 *
 * ov @187616399 = flushed stdout write (not a mode reset).
 * Pi @187616733 = Ype flush + process.exit (not a mode reset).
 * tr @189629037 strips DECSET so mouse / bracketed-paste / alt-screen
 * enable sequences are not replayed into the caller TTY.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import * as realDeleteJob from '../../daemon/deleteJob.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import {
  cursorAddress,
  formatClaudeLogsReplay,
  replayBgLogsStream,
} from '../bg/logsReplay.js'

const deleteJobSnap = snapshotModuleExports(realDeleteJob)

const resolveJobShortByPrefixMock = mock(
  async (
    _prefix: string,
  ): Promise<
    | { ok: true; short: string }
    | { ok: false; kind: 'none' | 'ambiguous'; matches: string[] }
  > => ({ ok: true, short: 'abcd1234' }),
)

mock.module('../../daemon/deleteJob.js', () => ({
  ...deleteJobSnap,
  resolveJobShortByPrefix: resolveJobShortByPrefixMock,
}))

const subscribeUnsubMock = mock(() => {})
const subscribeJobStreamTailMock = mock(
  (
    _short: string,
    _tail: number,
    onMessage: (msg: Record<string, unknown>) => void,
    _onError: (err: string) => void,
  ) => {
    queueMicrotask(() => onMessage({ type: 'snapshot', streamTail: ['hello'] }))
    return subscribeUnsubMock
  },
)

mock.module('../bg/logsSubscribe.js', () => ({
  subscribeJobStreamTail: subscribeJobStreamTailMock,
  sanitizeDaemonControlError: (text: string) => text,
  stalledSubscribeMessage: () => 'stalled',
}))

afterAll(() => {
  mock.module('../../daemon/deleteJob.js', () => ({ ...deleteJobSnap }))
})

const BG_SRC = readFileSync(join(import.meta.dir, '../bg.ts'), 'utf8')
const REPLAY_SRC = readFileSync(
  join(import.meta.dir, '../bg/logsReplay.ts'),
  'utf8',
)

describe('densable 2.1.248 #27 tr() replay filter', () => {
  test('strips mouse tracking, bracketed paste, and alt-screen DECSET', () => {
    const raw = `hi\x1B[?1000h\x1B[?2004h\x1B[?1049hthere`
    const { replay, cursorAddressed } = replayBgLogsStream(raw)
    expect(replay).toBe('hithere')
    expect(cursorAddressed).toBe(true)
  })

  test('mouse-only / paste-only DECSET does not set cursorAddressed', () => {
    const mouse = replayBgLogsStream(`x\x1B[?1000hy`)
    expect(mouse.replay).toBe('xy')
    expect(mouse.cursorAddressed).toBe(false)
    const paste = replayBgLogsStream(`x\x1B[?2004hy`)
    expect(paste.replay).toBe('xy')
    expect(paste.cursorAddressed).toBe(false)
  })

  test('keeps CUP and marks cursorAddressed', () => {
    const { replay, cursorAddressed } = replayBgLogsStream(`a\x1B[12;1Hb`)
    expect(replay).toBe('a\x1B[12;1Hb')
    expect(cursorAddressed).toBe(true)
  })

  test('keeps SGR reset and newlines; drops other C0', () => {
    const { replay } = replayBgLogsStream(`\x1B[0mline\n\x07bell`)
    expect(replay).toBe('\x1B[0mline\nbell')
  })

  test('TTY suffix is SGR reset; CUP+newline only when cursorAddressed', () => {
    expect(formatClaudeLogsReplay(['plain'], true, 24)).toBe('plain\x1B[0m')
    expect(formatClaudeLogsReplay(['plain'], false, 24)).toBe('plain')
    expect(formatClaudeLogsReplay(['\x1B[?1049hhi'], true, 24)).toBe(
      `hi\x1B[0m${cursorAddress(24, 1)}\n`,
    )
  })
})

describe('densable 2.1.248 #27 Pmr logsHandler', () => {
  const origExit = process.exit
  const writes: string[] = []
  const origWrite = process.stdout.write.bind(process.stdout)

  afterEach(() => {
    process.exit = origExit
    process.stdout.write = origWrite
    writes.length = 0
    resolveJobShortByPrefixMock.mockClear()
    subscribeJobStreamTailMock.mockClear()
    subscribeUnsubMock.mockClear()
    resolveJobShortByPrefixMock.mockImplementation(async () => ({
      ok: true,
      short: 'abcd1234',
    }))
    subscribeJobStreamTailMock.mockImplementation(
      (_short, _tail, onMessage) => {
        queueMicrotask(() =>
          onMessage({ type: 'snapshot', streamTail: ['hello'] }),
        )
        return subscribeUnsubMock
      },
    )
  })

  test('Pmr source has replay + ov + Pi and no cleanupTerminalModes', () => {
    const pmr = BG_SRC.slice(
      BG_SRC.indexOf('const CLI_BG_LOGS ='),
      BG_SRC.indexOf('export async function attachHandler'),
    )
    expect(pmr).toContain('cli_bg_logs')
    expect(pmr).toContain('formatClaudeLogsReplay')
    expect(pmr).toContain('exitAfterAnalyticsFlush(0)')
    expect(pmr).toContain('exitAfterAnalyticsFlush(1)')
    expect(pmr).not.toContain('cleanupTerminalModes')
    expect(pmr).not.toContain('session.logPath')
    expect(pmr).not.toContain('readFile(')
    expect(BG_SRC).toContain('Print the background session')
    expect(REPLAY_SRC).toContain('1049')
    expect(REPLAY_SRC).toContain('2004')
  })

  test('success path writes replay then Pi(0); unsubscribes snapshot', async () => {
    const { logsHandler } = await import('../bg.js')
    const exit = mock((code?: number) => {
      throw new Error(`exit:${code ?? ''}`)
    })
    process.exit = exit as typeof process.exit
    const stdout = process.stdout as NodeJS.WriteStream & {
      isTTY: boolean
    }
    const origIsTTY = stdout.isTTY
    stdout.isTTY = true
    process.stdout.write = ((chunk: unknown, cb?: unknown) => {
      writes.push(String(chunk))
      if (typeof cb === 'function') cb()
      return true
    }) as typeof process.stdout.write

    try {
      await expect(logsHandler('abcd')).rejects.toThrow('exit:0')
      expect(resolveJobShortByPrefixMock).toHaveBeenCalledWith('abcd')
      expect(subscribeJobStreamTailMock.mock.calls[0]?.[1]).toBe(500)
      expect(subscribeUnsubMock).toHaveBeenCalled()
      expect(writes.join('')).toBe('hello\x1B[0m')
      expect(exit).toHaveBeenCalledWith(0)
    } finally {
      stdout.isTTY = origIsTTY
    }
  })

  test('read_failed path writes stderr and Pi(1)', async () => {
    const { logsHandler } = await import('../bg.js')
    subscribeJobStreamTailMock.mockImplementation(
      (_short, _tail, _onMessage, onError) => {
        queueMicrotask(() => onError('control socket closed'))
        return subscribeUnsubMock
      },
    )
    const exit = mock((code?: number) => {
      throw new Error(`exit:${code ?? ''}`)
    })
    process.exit = exit as typeof process.exit
    const errWrites: string[] = []
    const origErr = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: unknown, cb?: unknown) => {
      errWrites.push(String(chunk))
      if (typeof cb === 'function') cb()
      return true
    }) as typeof process.stderr.write

    try {
      await expect(logsHandler('abcd')).rejects.toThrow('exit:1')
      expect(errWrites.join('')).toContain("Couldn't read logs for abcd1234")
      expect(errWrites.join('')).toContain('control socket closed')
      expect(exit).toHaveBeenCalledWith(1)
    } finally {
      process.stderr.write = origErr
    }
  })
})
