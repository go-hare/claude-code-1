/**
 * densable 2.1.289 `Cpr` / `Vr` — prompt.submit entry latch.
 *
 * Gold QE Art: `using Lt=Cpr(); Art({...,entries:Lt}); ... Lt.handedOff()`.
 * Unn `enter` registers a waiter on the stamped user uuid; dispose resolves
 * those waiters after handoff, or rejects if the batch ends first.
 * Never export densable ids.
 */

const DID_NOT_ENTER =
  'prompt.submit: the prompt did not enter the session (its batch ended before its turn)'

const waitersByUuid = new Map<
  string,
  Set<ReturnType<typeof Promise.withResolvers<void>>>
>()

export type PromptSubmitEntries = Disposable & {
  awaitEntry(uuid: string): Promise<void>
  handedOff(): void
}

/** densable `Cpr`. */
export function createPromptSubmitEntries(): PromptSubmitEntries {
  const owned = new Map<
    ReturnType<typeof Promise.withResolvers<void>>,
    string
  >()
  let handedOff = false
  return {
    awaitEntry(uuid) {
      const waiter = Promise.withResolvers<void>()
      const set = waitersByUuid.get(uuid) ?? new Set()
      set.add(waiter)
      waitersByUuid.set(uuid, set)
      owned.set(waiter, uuid)
      return waiter.promise
    },
    handedOff() {
      handedOff = true
    },
    [Symbol.dispose]() {
      for (const [waiter, uuid] of owned) {
        const set = waitersByUuid.get(uuid)
        if (!set || !set.delete(waiter)) continue
        if (set.size === 0) waitersByUuid.delete(uuid)
        if (handedOff) waiter.resolve()
        else waiter.reject(new Error(DID_NOT_ENTER))
      }
      owned.clear()
    },
  }
}

type EntryUser = {
  type: string
  uuid?: string
  promptSource?: unknown
}

/**
 * densable `Vr(Ke, messages)` — awaitEntry on the first user with
 * promptSource, else the first user. Gold Unn does not await this.
 */
export function registerPromptSubmitEntry(
  entries: PromptSubmitEntries,
  messages: readonly EntryUser[],
): Promise<void> {
  const users = messages.filter(message => message.type === 'user')
  const stamped =
    users.find(message => message.promptSource !== undefined) ?? users[0]
  return stamped?.uuid ? entries.awaitEntry(stamped.uuid) : Promise.resolve()
}

/**
 * densable `jq` / `pG` / `ipr` — session-start latch Unn awaits unless
 * the uuid is ahead of session start. Unset when no session-start is in flight.
 */
let sessionStartLatch: Promise<void> | undefined
let sessionStartResolve: (() => void) | undefined
const aheadOfSessionStartUuids = new Set<string>()

/** densable `ipr` — start or reuse the session-start promise. */
export function beginSessionStartLatch(): { complete: () => void } {
  if (sessionStartLatch && sessionStartResolve) {
    return { complete: () => {} }
  }
  const pending = Promise.withResolvers<void>()
  sessionStartLatch = pending.promise
  sessionStartResolve = pending.resolve
  const owned = pending.promise
  return {
    complete() {
      if (sessionStartLatch !== owned) return
      pending.resolve()
      sessionStartLatch = undefined
      sessionStartResolve = undefined
      aheadOfSessionStartUuids.clear()
    },
  }
}

/**
 * densable `Loe` / `sAe` / `Doe`. Mark only when the session-start latch is
 * in flight and rootEvent is undefined or session.start.
 */
export function markAheadOfSessionStart(
  uuid: string,
  rootEvent?: string,
): void {
  if (!sessionStartLatch) return
  if (rootEvent !== undefined && rootEvent !== 'session.start') return
  aheadOfSessionStartUuids.add(uuid)
}

export function isAheadOfSessionStart(uuid?: string): boolean {
  return uuid !== undefined && aheadOfSessionStartUuids.has(uuid)
}

/** densable `jq.get()`. */
export function getPromptSubmitLatch(): Promise<void> | undefined {
  return sessionStartLatch
}
