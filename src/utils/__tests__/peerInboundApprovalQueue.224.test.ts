/**
 * densable 2.1.224 #5 — gGn queueBehind dialog host (local Oy/Ns substitute).
 */
import { describe, expect, test } from 'bun:test'
import { createPeerInboundApprovalQueue } from '../peerInboundApprovalQueue.js'
import type { PeerInboundApprovalPayload } from '../../components/PeerInboundApprovalDialog.js'

function payload(preview: string): PeerInboundApprovalPayload {
  return {
    holdCause: 'mode-mismatch',
    preview,
  }
}

describe('densable 2.1.224 #5 peerInboundApprovalQueue', () => {
  test('queueBehind: second open waits until first answers', async () => {
    const q = createPeerInboundApprovalQueue()
    const p1 = q.open(payload('a'))
    const p2 = q.open(payload('b'))
    expect(q.getActivePayload()?.preview).toBe('a')
    q.answer('approve')
    await expect(p1).resolves.toBe('approve')
    expect(q.getActivePayload()?.preview).toBe('b')
    q.answer('deny')
    await expect(p2).resolves.toBe('deny')
    expect(q.getActivePayload()).toBeNull()
  })

  test('AbortSignal cancels waiting entry without showing it', async () => {
    const q = createPeerInboundApprovalQueue()
    const ac = new AbortController()
    const p1 = q.open(payload('first'))
    const p2 = q.open(payload('second'), { signal: ac.signal })
    expect(q.getActivePayload()?.preview).toBe('first')
    ac.abort()
    await expect(p2).resolves.toBe('cancelled')
    // first still active
    expect(q.getActivePayload()?.preview).toBe('first')
    q.answer('deny')
    await expect(p1).resolves.toBe('deny')
  })

  test('AbortSignal cancels active entry', async () => {
    const q = createPeerInboundApprovalQueue()
    const ac = new AbortController()
    const p1 = q.open(payload('x'), { signal: ac.signal })
    expect(q.getActivePayload()?.preview).toBe('x')
    ac.abort()
    await expect(p1).resolves.toBe('cancelled')
    expect(q.getActivePayload()).toBeNull()
  })

  test('isSlotFree false defers until tryPump when free', async () => {
    let free = false
    const q = createPeerInboundApprovalQueue({ isSlotFree: () => free })
    const p1 = q.open(payload('deferred'))
    expect(q.getActivePayload()).toBeNull()
    free = true
    q.tryPump()
    expect(q.getActivePayload()?.preview).toBe('deferred')
    q.answer('approve')
    await expect(p1).resolves.toBe('approve')
  })

  test('cancelKeys drops matching active/waiting without affecting others', async () => {
    const q = createPeerInboundApprovalQueue()
    const k1 = { id: 1 }
    const k2 = { id: 2 }
    const p1 = q.open(payload('one'), { key: k1 })
    const p2 = q.open(payload('two'), { key: k2 })
    expect(q.getActivePayload()?.preview).toBe('one')
    q.cancelKeys([k1])
    await expect(p1).resolves.toBe('cancelled')
    expect(q.getActivePayload()?.preview).toBe('two')
    q.answer('approve')
    await expect(p2).resolves.toBe('approve')
  })

  test('subscribe notifies on active change', () => {
    const q = createPeerInboundApprovalQueue()
    let n = 0
    const unsub = q.subscribe(() => {
      n += 1
    })
    void q.open(payload('s'))
    expect(n).toBeGreaterThanOrEqual(1)
    q.answer('deny')
    unsub()
  })
})
