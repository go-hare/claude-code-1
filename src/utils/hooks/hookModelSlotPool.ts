import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { all } from '../generators.js'
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'
import { AsyncLocalStorage } from 'async_hooks'

/**
 * Common logic for executing hooks
 * @param hookInput The structured hook input that will be validated and converted to JSON
 * @param toolUseID The ID for tracking this hook execution
 * @param matchQuery The query to match against hook matchers
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @param toolUseContext Optional ToolUseContext for prompt-based hooks (required if using prompt hooks)
 * @param messages Optional conversation history for prompt/function hooks
 * @returns Async generator that yields progress messages and hook results
 */
/** #928 (official `fJe = 12`): max concurrent prompt/agent hooks per event. */
export const MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT = 12

/** #1336 (official `Nan = 24`): max concurrent prompt/agent hooks per session. */
export const MAX_CONCURRENT_MODEL_HOOKS_PER_SESSION = 24

/** #1336 (official `rmr = 12`): max overdue prompt/agent hooks per session. */
export const MAX_OVERDUE_MODEL_HOOKS_PER_SESSION = 12

/** #1336 (official `smr = 1`): minimum timeout in seconds for model hooks. */
export const MIN_MODEL_HOOK_TIMEOUT_SECONDS = 1

const MODEL_HOOK_HOLD_GRACE_MS = 10_000

const MODEL_HOOKS_SLOT = 'model hooks'

const OVERDUE_MODEL_HOOKS_SLOT = 'overdue model hooks'

const MAX_SAFE_TIMER_MS = 2_147_483_647

export function resolveModelHookTimeoutMs(
  hook: { timeout?: number },
  defaultTimeoutMs: number,
): number {
  return hook.timeout
    ? Math.max(hook.timeout, MIN_MODEL_HOOK_TIMEOUT_SECONDS) * 1000
    : defaultTimeoutMs
}

type SlotWaiter = {
  limit: number
  signal: AbortSignal
  grant: () => void
  cancel: () => void
}

type SlotBucket = {
  active: number
  waiters: SlotWaiter[]
}

/**
 * Gold `XNt` (#1336) — FIFO semaphore pool keyed by slot name.
 */
export class ModelHookSlotPool {
  private buckets = new Map<string, SlotBucket>()

  acquire(
    slot: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<(() => void) | undefined> {
    const bucket = this.getBucket(slot)
    const release = () => {
      bucket.active -= 1
      this.drain(bucket)
    }
    if (signal.aborted) {
      return Promise.resolve(undefined)
    }
    if (bucket.active < limit && bucket.waiters.length === 0) {
      bucket.active += 1
      return Promise.resolve(release)
    }
    return new Promise(resolve => {
      const onAbort = () => {
        const idx = bucket.waiters.indexOf(waiter)
        if (idx !== -1) {
          bucket.waiters.splice(idx, 1)
        }
        resolve(undefined)
        this.drain(bucket)
      }
      const waiter: SlotWaiter = {
        limit,
        signal,
        grant: () => {
          signal.removeEventListener('abort', onAbort)
          resolve(release)
        },
        cancel: () => resolve(undefined),
      }
      bucket.waiters.push(waiter)
      signal.addEventListener('abort', onAbort, { once: true })
      this.drain(bucket)
    })
  }

  wouldWait(slot: string, limit: number): boolean {
    const bucket = this.getBucket(slot)
    return bucket.active >= limit || bucket.waiters.length > 0
  }

  occupy(slot: string): () => void {
    const bucket = this.getBucket(slot)
    bucket.active += 1
    return () => {
      bucket.active -= 1
      this.drain(bucket)
    }
  }

  private drain(bucket: SlotBucket): void {
    while (
      bucket.waiters.length > 0 &&
      bucket.active < bucket.waiters[0]!.limit
    ) {
      const next = bucket.waiters.shift()!
      if (next.signal.aborted) {
        next.cancel()
        continue
      }
      bucket.active += 1
      next.grant()
    }
  }

  private getBucket(slot: string): SlotBucket {
    let bucket = this.buckets.get(slot)
    if (!bucket) {
      bucket = { active: 0, waiters: [] }
      this.buckets.set(slot, bucket)
    }
    return bucket
  }
}

export type SessionModelHookSlots = {
  slots: ModelHookSlotPool
  holder: AsyncLocalStorage<{ isHeld: boolean }>
}

export function createSessionModelHookSlots(): SessionModelHookSlots {
  return {
    slots: new ModelHookSlotPool(),
    holder: new AsyncLocalStorage<{ isHeld: boolean }>(),
  }
}

const sessionModelHookSlotsByHost = new HostSlot<SessionModelHookSlots>(() =>
  createSessionModelHookSlots(),
)

export function getSessionModelHookSlots(): SessionModelHookSlots {
  return sessionModelHookSlotsByHost.of(getBootstrapSessionHost())
}

async function waitForModelHookSlot(
  pool: ModelHookSlotPool,
  slot: string,
  limit: number,
  signal: AbortSignal,
  waitLimitMs: number,
): Promise<{ seated: boolean; release: () => void } | undefined> {
  const combined = createCombinedAbortSignal(signal, {
    timeoutMs: waitLimitMs,
  })
  let release = await pool.acquire(slot, limit, combined.signal)
  combined.cleanup()
  if (release === undefined && signal.aborted) {
    return undefined
  }
  return {
    seated: release !== undefined,
    release: () => {
      release?.()
      release = undefined
    },
  }
}

function advanceWithHeldSlot<T>(
  gen: AsyncGenerator<T, void>,
  sessionSlots: SessionModelHookSlots,
  release: (() => void) | undefined,
  hookTimeoutMs: number,
): Promise<IteratorResult<T, void>> {
  if (release === undefined) {
    return gen.next()
  }
  const state = { isHeld: true }
  const doRelease = () => {
    if (state.isHeld) {
      state.isHeld = false
      release()
    }
  }
  const timer = setTimeout(
    doRelease,
    Math.min(hookTimeoutMs, MAX_SAFE_TIMER_MS - MODEL_HOOK_HOLD_GRACE_MS) +
      MODEL_HOOK_HOLD_GRACE_MS,
  )
  timer.unref?.()
  const settle = () => {
    clearTimeout(timer)
    doRelease()
  }
  const nextPromise = sessionSlots.holder.run(state, () => gen.next())
  nextPromise.then(settle, settle)
  return nextPromise
}

function wrapModelHookGeneratorWithSessionSlot<T>(
  gen: AsyncGenerator<T, void>,
  hookTimeoutMs: number,
  slotCtx: {
    slots: SessionModelHookSlots
    signal: AbortSignal
    limitMs: number
  },
  batchAbortSignal: AbortSignal,
): AsyncGenerator<T, void> {
  let started = false
  const wrapped: AsyncGenerator<T, void> = {
    next: () => {
      if (started) {
        return gen.next()
      }
      started = true
      if (batchAbortSignal.aborted) {
        return gen.return(undefined)
      }
      if (slotCtx.slots.holder.getStore()?.isHeld === true) {
        return gen.next()
      }
      if (
        !slotCtx.slots.slots.wouldWait(
          MODEL_HOOKS_SLOT,
          MAX_CONCURRENT_MODEL_HOOKS_PER_SESSION,
        )
      ) {
        return advanceWithHeldSlot(
          gen,
          slotCtx.slots,
          slotCtx.slots.slots.occupy(MODEL_HOOKS_SLOT),
          hookTimeoutMs,
        )
      }
      const combined = createCombinedAbortSignal(slotCtx.signal, {
        // Combine with batchAbortSignal via listener below
      })
      const onBatchAbort = () => {
        combined.cleanup()
      }
      batchAbortSignal.addEventListener('abort', onBatchAbort, { once: true })
      const effectiveSignal = AbortSignal.any([
        slotCtx.signal,
        batchAbortSignal,
      ])
      return waitForModelHookSlot(
        slotCtx.slots.slots,
        MODEL_HOOKS_SLOT,
        MAX_CONCURRENT_MODEL_HOOKS_PER_SESSION,
        effectiveSignal,
        slotCtx.limitMs,
      )
        .then(ticket =>
          ticket?.seated === false
            ? slotCtx.slots.slots.acquire(
                OVERDUE_MODEL_HOOKS_SLOT,
                MAX_OVERDUE_MODEL_HOOKS_PER_SESSION,
                effectiveSignal,
              )
            : ticket?.release,
        )
        .then(release => {
          batchAbortSignal.removeEventListener('abort', onBatchAbort)
          combined.cleanup()
          if (batchAbortSignal.aborted) {
            release?.()
            return gen.return(undefined)
          }
          return advanceWithHeldSlot(gen, slotCtx.slots, release, hookTimeoutMs)
        })
    },
    return: value => gen.return(value),
    throw: err => gen.throw(err),
    [Symbol.asyncIterator]: () => wrapped,
    [Symbol.asyncDispose]: () =>
      gen[Symbol.asyncDispose]?.() ?? Promise.resolve(),
  }
  return wrapped
}

/**
 * #928 / #1336 (official `zan`): run non-model hooks uncapped while capping
 * prompt/agent hooks at 12 per event AND 24 per session (+ 12 overdue).
 */
export async function* mergeHookGeneratorsWithModelCap<T>(
  entries: ReadonlyArray<{
    isModelHook: boolean
    generator: AsyncGenerator<T, void>
    timeoutMs?: number
  }>,
  maxConcurrentModelHooks = MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
  sessionSlotCtx?: {
    slots: SessionModelHookSlots
    signal: AbortSignal
    limitMs: number
  },
): AsyncGenerator<T, void> {
  const modelEntries = entries.filter(e => e.isModelHook)
  if (!sessionSlotCtx) {
    const modelGens = modelEntries.map(e => e.generator)
    if (modelGens.length <= 1) {
      yield* all(entries.map(e => e.generator))
      return
    }
    const nonModelGens = entries
      .filter(e => !e.isModelHook)
      .map(e => e.generator)
    yield* all([...nonModelGens, all(modelGens, maxConcurrentModelHooks)])
    return
  }

  const batchAbort = new AbortController()
  try {
    if (modelEntries.length <= 1) {
      yield* all(
        entries.map(e =>
          e.isModelHook
            ? wrapModelHookGeneratorWithSessionSlot(
                e.generator,
                e.timeoutMs ?? sessionSlotCtx.limitMs,
                sessionSlotCtx,
                batchAbort.signal,
              )
            : e.generator,
        ),
      )
      return
    }
    const nonModelGens = entries
      .filter(e => !e.isModelHook)
      .map(e => e.generator)
    const wrappedModelGens = modelEntries.map(e =>
      wrapModelHookGeneratorWithSessionSlot(
        e.generator,
        e.timeoutMs ?? sessionSlotCtx.limitMs,
        sessionSlotCtx,
        batchAbort.signal,
      ),
    )
    yield* all([
      ...nonModelGens,
      all(wrappedModelGens, maxConcurrentModelHooks),
    ])
  } finally {
    batchAbort.abort()
  }
}
