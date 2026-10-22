import { afterEach, describe, expect, test } from 'bun:test'
import instances, {
  bindInkSessionHost,
  Ns,
  resetInkSessionHostForTests,
} from '../instances.js'
import { da1, TerminalQuerier } from '../terminal-querier.js'

describe('densable 2.1.289 Ns Ht factory / querier.owed', () => {
  afterEach(() => {
    resetInkSessionHostForTests()
  })

  test('two Ns() calls return the same map as the default export', () => {
    expect(Ns()).toBe(Ns())
    expect(Ns()).toBe(instances)
  })

  test('bindInkSessionHost keys Ns off U().host', () => {
    const hostA = {}
    const hostB = {}
    bindInkSessionHost(() => hostA)
    const mapA = Ns()
    bindInkSessionHost(() => hostB)
    const mapB = Ns()
    expect(mapA).not.toBe(mapB)
    bindInkSessionHost(() => hostA)
    expect(Ns()).toBe(mapA)
  })

  test('owed() is 0 on an empty querier', () => {
    const stdout = {
      write() {
        return true
      },
    } as unknown as NodeJS.WriteStream
    expect(new TerminalQuerier(stdout).owed()).toBe(0)
  })

  test('setInputAttached holds writes until stdin readable is live', () => {
    const writes: string[] = []
    const stdout = {
      write(chunk: string) {
        writes.push(chunk)
        return true
      },
    } as unknown as NodeJS.WriteStream
    const querier = new TerminalQuerier(stdout)
    const query = da1()
    void querier.send(query)
    void querier.flush()
    expect(writes).toEqual([])
    // gold owed() skips unwritten sentinels and never counts queries
    expect(querier.owed()).toBe(0)
    querier.setInputAttached(true)
    expect(writes).toEqual([query.request, query.request])
    expect(querier.owed()).toBe(1)
    querier.setInputAttached(false)
    void querier.flush()
    expect(writes).toEqual([query.request, query.request])
    expect(querier.owed()).toBe(1)
    querier.setInputAttached(true)
    expect(writes).toHaveLength(3)
    expect(querier.owed()).toBe(2)
  })

  test('owed counts written sentinels and barriers, not queries', async () => {
    const stdout = {
      write() {
        return true
      },
    } as unknown as NodeJS.WriteStream
    const querier = new TerminalQuerier(stdout)
    querier.setInputAttached(true)
    void querier.send(da1())
    expect(querier.owed()).toBe(0)
    const flushed = querier.flush()
    expect(querier.owed()).toBe(1)
    querier.resync({ probe: true })
    expect(querier.owed()).toBe(1)
    expect(await flushed).toBe(false)
    querier.onResponse({ type: 'da1', params: [] })
    expect(querier.owed()).toBe(0)
  })

  test('onResponse unmatched kittyGraphics is false; DA1 flush resolves true', async () => {
    const stdout = {
      write() {
        return true
      },
    } as unknown as NodeJS.WriteStream
    const querier = new TerminalQuerier(stdout)
    querier.setInputAttached(true)
    const flushed = querier.flush()
    expect(
      querier.onResponse({ type: 'kittyGraphics', id: 31, message: 'ENOTSUP' }),
    ).toBe(false)
    expect(querier.onResponse({ type: 'da1', params: [] })).toBe(true)
    expect(await flushed).toBe(true)
  })

  test('set throws when occupant still holds raw mode', () => {
    const stdout = { fd: 1 } as unknown as NodeJS.WriteStream
    const occupant = {
      hasUnmounted: false,
      holdsRawMode: true,
    } as never
    const other = {
      hasUnmounted: false,
      holdsRawMode: false,
    } as never
    Ns().set(stdout, occupant)
    expect(() => Ns().set(stdout, other)).toThrow(
      /second root created on a stream whose mounted root still holds stdin/,
    )
    Ns().delete(stdout)
  })
})
