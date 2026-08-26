/**
 * densable 2.1.239 #39 — `_ts` title write coalesce + token bucket.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { debugMock } from '../../../tests/mocks/debug.js'

mock.module('src/utils/debug.ts', debugMock)

import {
  createTitleWriteScheduler,
  type TitleWriteResult,
} from '../titleWriteScheduler.js'

const schedulerSrc = readFileSync(
  join(import.meta.dir, '../titleWriteScheduler.ts'),
  'utf8',
)
const replSrc = readFileSync(
  join(import.meta.dir, '../initReplBridge.ts'),
  'utf8',
)
const mainSrc = readFileSync(join(import.meta.dir, '../bridgeMain.ts'), 'utf8')

function landedWrite() {
  return mock(async (_sessionId: string, _title: string) => {
    return 'landed' as TitleWriteResult
  })
}

describe('densable 2.1.239 #39 _ts title write scheduler', () => {
  test('source gold: official defaults burst=3 / refill 1e4 / retry 60000', () => {
    expect(schedulerSrc).toContain('burst: opts?.burst ?? 3')
    expect(schedulerSrc).toContain('refillMs: opts?.refillMs ?? 1e4')
    expect(schedulerSrc).toContain('retryMs: opts?.retryMs ?? 60_000')
    expect(schedulerSrc).toContain('sending latest after coalescing')
  })

  test('call sites use _ts, not raw uAl', () => {
    expect(replSrc).toContain('createTitleWriteScheduler')
    expect(replSrc).toContain('titleWriter')
    expect(mainSrc).toContain('createTitleWriteScheduler')
    expect(mainSrc).toContain('titleWriter.noteRemoteTitle')
  })

  test('first title PATCHes once', async () => {
    const writeTitle = landedWrite()
    const s = createTitleWriteScheduler({ writeTitle, retryMs: 60_000 })
    await s.update('sid', 'hello')
    expect(writeTitle).toHaveBeenCalledTimes(1)
    expect(writeTitle.mock.calls[0]?.[1]).toBe('hello')
    expect(s.hasSent('sid', 'hello')).toBe(true)
  })

  test('gyh: same title after landed is a no-op', async () => {
    const writeTitle = landedWrite()
    const s = createTitleWriteScheduler({ writeTitle, retryMs: 60_000 })
    await s.update('sid', 'hello')
    await s.update('sid', 'hello')
    expect(writeTitle).toHaveBeenCalledTimes(1)
  })

  test('userInitiated bypasses gyh lastSentOk', async () => {
    const writeTitle = landedWrite()
    const s = createTitleWriteScheduler({ writeTitle, retryMs: 60_000 })
    await s.update('sid', 'hello')
    await s.update('sid', 'hello', { userInitiated: true })
    expect(writeTitle).toHaveBeenCalledTimes(2)
  })

  test('inFlight coalesces to the latest title', async () => {
    let hold = true
    let releaseFirst!: (result: TitleWriteResult) => void
    const writeTitle = mock((_sessionId: string, _title: string) => {
      if (hold) {
        return new Promise<TitleWriteResult>(resolve => {
          releaseFirst = resolve
        })
      }
      return Promise.resolve('landed' as TitleWriteResult)
    })
    const s = createTitleWriteScheduler({ writeTitle, retryMs: 60_000 })
    const first = s.update('sid', 'one')
    await Promise.resolve()
    expect(writeTitle).toHaveBeenCalledTimes(1)
    const second = s.update('sid', 'two')
    const third = s.update('sid', 'three')
    expect(writeTitle).toHaveBeenCalledTimes(1)
    hold = false
    releaseFirst('landed')
    await first
    await second
    await third
    expect(writeTitle).toHaveBeenCalledTimes(2)
    expect(writeTitle.mock.calls[1]?.[1]).toBe('three')
  })

  test('noteRemoteTitle marks lastSentOk and suppresses later same title', async () => {
    const writeTitle = landedWrite()
    const s = createTitleWriteScheduler({ writeTitle, retryMs: 60_000 })
    s.noteRemoteTitle('sid', 'from-server')
    await s.update('sid', 'from-server')
    expect(writeTitle).toHaveBeenCalledTimes(0)
  })
})
