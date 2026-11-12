/**
 * densable `L` with holdAtDeadline. The first deadline returns timed_out.
 * The same request stays. A late body is classified aside and does not
 * replace that result.
 */
import { describe, expect, test } from 'bun:test'
import { StructuredIO } from '../structuredIO.js'

function hold(gate: Promise<void>): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      await gate
      yield* []
    },
  }
}

const call = {
  instanceId: 'inst',
  host: 'desk',
  name: 'Bash',
  input: { command: 'true' },
  envelope: { op: 'call', call_id: 'tu' },
  toolUseId: 'tu',
  issuedAt: 0,
  deadlineMs: 30,
}

describe('remote tool deadline hold (densable L)', () => {
  test('the first deadline returns timed_out and a late body does not replace it', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const io = new StructuredIO(hold(gate))
    const reading = (async () => {
      for await (const _message of io.structuredInput) {
        void _message
      }
    })()
    const outbound = (async () => {
      for await (const message of io.outbound) {
        return message
      }
      return undefined
    })()
    const answer = io.requestRemoteToolCall(call)
    const sent = await outbound
    const requestId =
      sent && 'request_id' in sent && typeof sent.request_id === 'string'
        ? sent.request_id
        : ''
    expect(requestId).not.toBe('')
    // The write was handed off, so the first deadline leaves it standing.
    const first = await answer
    expect(first).toEqual({ kind: 'deadline', requestId })
    const holder = io.takeHeldRemoteTool(requestId)
    expect(holder).toBeDefined()
    expect(holder?.delivery()).toBe('delivered')
    expect(holder?.accepted()).toBe(true)
    // Taking it back ends the standing wait. The first result stays.
    expect(holder?.takeBack()).toBe(true)
    const late = await holder?.late
    expect(late?.kind).toBe('taken_back')
    expect(first).toEqual({ kind: 'deadline', requestId })
    release()
    await reading
  })

  test('a request still queued at the deadline is stalled and taken back', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const io = new StructuredIO(hold(gate))
    const reading = (async () => {
      for await (const _message of io.structuredInput) {
        void _message
      }
    })()
    // Nobody reads outbound, so the write stays in the queue.
    const first = await io.requestRemoteToolCall(call)
    expect(first?.kind).toBe('stalled')
    expect(first?.takenBack).toBe(true)
    release()
    await reading
  })
})
