/**
 * densable be / wr @190739086 — durable subscribe pendingOps + Vk(wr) drain (2.1.248).
 * Gold: docs/upstream-extraction/v2.1.248/snippets/gold-248-vk-callers.txt §3
 */
import { registerPreExitFlush } from '../../utils/cleanupRegistry.js'
import { un } from './store.js'

/** densable wr drain budget — official 1e4. */
export const DURABLE_PENDING_OPS_DRAIN_MS = 10_000

/** densable un — race promise vs timeout; resolves when either completes (never rejects). */
async function unRace(work: Promise<unknown>, ms: number): Promise<void> {
  await new Promise<void>(resolve => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    const t = setTimeout(done, ms)
    t.unref?.()
    void work.then(done, done).finally(() => clearTimeout(t))
  })
}

/** densable wr — drain in-flight durable subscribe promises before exit. */
export async function wr(): Promise<void> {
  const { pendingOps } = un().durable
  await unRace(
    Promise.allSettled([...pendingOps]),
    DURABLE_PENDING_OPS_DRAIN_MS,
  )
}

/** densable be — track subscribe promise; Vk(wr) on each add (official idempotent bag). */
export function be(e: Promise<unknown>): void {
  const { pendingOps } = un().durable
  pendingOps.add(e)
  const r = (): void => {
    pendingOps.delete(e)
  }
  void e.then(r, r)
  registerPreExitFlush(wr)
}
