/**
 * densable 2.1.219 #6 — `_Is` / `Yud` process-global stream-json writer.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  getStreamJsonStdoutWriter,
  setStreamJsonStdoutWriter,
  type StreamJsonStdoutWriter,
} from '../streamJsonStdoutWriter.js'

describe('densable 2.1.219 streamJsonStdoutWriter (_Is/Yud)', () => {
  afterEach(() => {
    setStreamJsonStdoutWriter(undefined)
  })

  test('defaults to undefined', () => {
    setStreamJsonStdoutWriter(undefined)
    expect(getStreamJsonStdoutWriter()).toBeUndefined()
  })

  test('set then get returns same writer', () => {
    const writes: unknown[] = []
    const writer: StreamJsonStdoutWriter = {
      write: async msg => {
        writes.push(msg)
      },
    }
    setStreamJsonStdoutWriter(writer)
    expect(getStreamJsonStdoutWriter()).toBe(writer)
    void getStreamJsonStdoutWriter()?.write({ type: 'keep_alive' } as never)
    expect(writes).toHaveLength(1)
  })

  test('clearing writer returns undefined', () => {
    setStreamJsonStdoutWriter({
      write: async () => {},
    })
    setStreamJsonStdoutWriter(undefined)
    expect(getStreamJsonStdoutWriter()).toBeUndefined()
  })
})
