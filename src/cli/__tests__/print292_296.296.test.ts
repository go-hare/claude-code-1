import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { handleHeadlessSendNow } from '../../utils/foregroundToolCalls.js'
import {
  PrintTextResults,
  finalizeHeldBackResultForShutdown,
  formatPrintWaitNotice,
  shouldFlushHeldBackResultOnAbort,
  shouldWriteWaitNoticeOnStderr,
} from '../print.js'

describe('print & foregroundToolCalls 2.1.292-2.1.296 alignment', () => {
  test('#220 handleHeadlessSendNow does not abort when deliver() backgrounds waiting work', () => {
    const ac = new AbortController()
    const res = handleHeadlessSendNow({
      queuedCommands: [{ uuid: 'u1', origin: { kind: 'human' } }],
      turnUnderWay: true,
      abortController: ac,
      deliver: () => true,
    })
    expect(res).toEqual({ still_queued: ['u1'], send_now: 'delivering' })
    expect(ac.signal.aborted).toBe(false)

    const resStop = handleHeadlessSendNow({
      queuedCommands: [{ uuid: 'u2', origin: { kind: 'human' } }],
      turnUnderWay: true,
      abortController: ac,
      deliver: () => false,
    })
    expect(resStop).toEqual({ still_queued: ['u2'], send_now: 'stopped' })
    expect(ac.signal.aborted).toBe(true)

    const resEmpty = handleHeadlessSendNow({
      queuedCommands: [],
      turnUnderWay: true,
      abortController: new AbortController(),
      deliver: () => false,
    })
    expect(resEmpty).toEqual({ still_queued: [], send_now: 'nothing_waiting' })
  })

  test('#232 finalizeHeldBackResultForShutdown clears queued_turn_count when stopping', () => {
    const held = { type: 'result', subtype: 'success', queued_turn_count: 2 }
    expect(finalizeHeldBackResultForShutdown(held, false)).toEqual(held)
    expect(finalizeHeldBackResultForShutdown(held, true)).toEqual({
      type: 'result',
      subtype: 'success',
      queued_turn_count: 0,
    })
    expect(
      shouldFlushHeldBackResultOnAbort({
        aborted: true,
        shuttingDown: false,
        abortedForShutdown: false,
        teardownRequested: false,
        heldResultCount: 1,
      }),
    ).toBe(true)
    expect(
      shouldFlushHeldBackResultOnAbort({
        aborted: true,
        shuttingDown: true,
        abortedForShutdown: true,
        teardownRequested: false,
        heldResultCount: 1,
      }),
    ).toBe(false)
  })

  test('#347 formats wait notice and checks TTY stderr eligibility', () => {
    expect(
      shouldWriteWaitNoticeOnStderr({
        outputFormat: 'text',
        stderrIsTerminal: true,
        stdoutIsTerminal: true,
      }),
    ).toBe(true)
    expect(
      shouldWriteWaitNoticeOnStderr({
        outputFormat: 'stream-json',
        stderrIsTerminal: true,
        stdoutIsTerminal: true,
      }),
    ).toBe(false)
    expect(
      formatPrintWaitNotice(
        [{ type: 'local_bash', description: 'npm test' }],
        true,
      ),
    ).toBe(
      'Waiting for background work to finish (bash "npm test", scheduled wakeup). Press Ctrl+C to exit now.',
    )
  })

  test('#359 PrintTextResults prints each turn response when turn ends without dropping earlier turns', () => {
    const chunks: string[] = []
    const printer = new PrintTextResults({}, text => chunks.push(text))
    const r1 = {
      type: 'result' as const,
      subtype: 'success',
      result: 'First turn',
    }
    const r2 = {
      type: 'result' as const,
      subtype: 'success',
      result: 'Second turn',
    }

    printer.printAtTurnEnd(r1)
    printer.printAtTurnEnd(r2)
    printer.printAtExit(r2)

    expect(chunks.join('')).toBe('First turn\n\nSecond turn\n')
  })

  test('#494 applyPluginMcpDiff filters disabled MCP servers via isMcpServerDisabled', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'print', 'mcpAndPlugins.ts'),
      'utf8',
    )
    const idx = src.indexOf('async function applyPluginMcpDiff()')
    expect(idx).toBeGreaterThan(-1)
    const slice = src.slice(idx, idx + 450)
    expect(slice).toContain('if (isMcpServerDisabled(name)) continue')
  })
})
