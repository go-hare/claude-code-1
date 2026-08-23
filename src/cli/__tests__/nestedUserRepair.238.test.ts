/**
 * densable 2.1.238 EM0 / wM0 — remote nested-user unwrap vs local exit.
 * Does not invent extra envelope keys. No process-global settings mock.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { _resetForTesting } from '../../services/analytics/index.js'
import { StructuredIO, tryUnwrapNestedUserMessage } from '../structuredIO.js'

class RemoteStructuredIO extends StructuredIO {
  override isRemoteTransport(): boolean {
    return true
  }
}

async function* lineStream(lines: string[]): AsyncIterable<string> {
  for (const line of lines) {
    yield `${line}\n`
  }
}

async function collect(
  io: StructuredIO,
): Promise<Array<{ type?: string; message?: unknown }>> {
  const out: Array<{ type?: string; message?: unknown }> = []
  for await (const msg of io.structuredInput) {
    out.push(msg as { type?: string; message?: unknown })
  }
  return out
}

describe('tryUnwrapNestedUserMessage (EM0)', () => {
  test('plain nested envelope', () => {
    const inner = { role: 'user' as const, content: 'hi' }
    const unwrap = tryUnwrapNestedUserMessage({
      type: 'user',
      message: inner,
      uuid: 'u1',
    })
    expect(unwrap?.plain).toBe(true)
    expect(unwrap?.inner).toBe(inner)
  })

  test('extra envelope key → not plain', () => {
    const unwrap = tryUnwrapNestedUserMessage({
      type: 'user',
      message: { role: 'user', content: 'hi' },
      extra: true,
    })
    expect(unwrap?.plain).toBe(false)
  })

  test('isSynthetic false + shouldQuery true still plain', () => {
    const unwrap = tryUnwrapNestedUserMessage({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'x' }] },
      isSynthetic: false,
      shouldQuery: true,
    })
    expect(unwrap?.plain).toBe(true)
  })

  test('missing nested user → undefined', () => {
    expect(
      tryUnwrapNestedUserMessage({ role: 'assistant', content: 'nope' }),
    ).toBeUndefined()
  })
})

describe('StructuredIO remote nested-user repair', () => {
  const origExit = process.exit
  const origError = console.error

  afterEach(() => {
    process.exit = origExit
    console.error = origError
    delete process.env.CLAUDE_CODE_DISABLE_NESTED_USER_REPAIR
    _resetForTesting()
  })

  test('local StructuredIO exits on invalid role', async () => {
    const exit = mock((code?: number) => {
      throw new Error(`exit:${code ?? ''}`)
    })
    process.exit = exit as typeof process.exit
    console.error = () => {}
    const io = new StructuredIO(
      lineStream([
        JSON.stringify({
          type: 'user',
          uuid: 'local-bad',
          message: { role: 'assistant', content: 'x' },
        }),
      ]),
    )
    await expect(collect(io)).rejects.toThrow(/exit:1/)
    expect(exit).toHaveBeenCalled()
  })

  test('remote repairs one-level nested user', async () => {
    const inner = { role: 'user', content: 'hello nested' }
    const io = new RemoteStructuredIO(
      lineStream([
        JSON.stringify({
          type: 'user',
          uuid: 'remote-ok',
          message: { type: 'user', message: inner },
        }),
      ]),
    )
    const out = await collect(io)
    expect(out).toHaveLength(1)
    expect(out[0]?.message).toEqual(inner)
  })

  test('remote unwrap_refused extra keys → drop', async () => {
    const io = new RemoteStructuredIO(
      lineStream([
        JSON.stringify({
          type: 'user',
          uuid: 'refused',
          message: {
            type: 'user',
            message: { role: 'user', content: 'x' },
            extra: 1,
          },
        }),
      ]),
    )
    const out = await collect(io)
    expect(out).toHaveLength(0)
  })

  test('remote repair_disabled drops instead of unwrap', async () => {
    process.env.CLAUDE_CODE_DISABLE_NESTED_USER_REPAIR = '1'
    const inner = { role: 'user', content: 'held' }
    const io = new RemoteStructuredIO(
      lineStream([
        JSON.stringify({
          type: 'user',
          uuid: 'disabled',
          message: { type: 'user', message: inner },
        }),
      ]),
    )
    const out = await collect(io)
    expect(out).toHaveLength(0)
  })

  test('SEA V.X Un(): DISABLE=0 / false still repairs', async () => {
    for (const raw of ['0', 'false'] as const) {
      process.env.CLAUDE_CODE_DISABLE_NESTED_USER_REPAIR = raw
      const inner = { role: 'user', content: `held-${raw}` }
      const io = new RemoteStructuredIO(
        lineStream([
          JSON.stringify({
            type: 'user',
            uuid: `disabled-${raw}`,
            message: { type: 'user', message: inner },
          }),
        ]),
      )
      const out = await collect(io)
      expect(out).toHaveLength(1)
      expect(out[0]?.message).toEqual(inner)
    }
  })

  test('remote malformed control_request drops instead of exit', async () => {
    const io = new RemoteStructuredIO(
      lineStream([
        JSON.stringify({
          type: 'control_request',
          uuid: 'ctrl-bad',
          request: null,
        }),
      ]),
    )
    const out = await collect(io)
    expect(out).toHaveLength(0)
  })
})
