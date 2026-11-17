/**
 * densable `Ra` / `wrr` / `tAn` / `Err` / `TYo` / `xbt` / `yk` — ALS turnAttributionKey.
 */
import { AsyncLocalStorage } from 'async_hooks'

type TurnAttributionStore = { key: string | undefined }

const als = new AsyncLocalStorage<TurnAttributionStore>()

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asUuidKey(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_SHAPE.test(value) ? value : undefined
}

/** densable `wrr` — run `fn` inside a fresh turn attribution store. */
export function runWithTurnAttribution<T>(
  key: string | undefined,
  fn: () => T,
): T {
  return als.run({ key }, fn)
}

/** densable `tAn` — current ALS key, or undefined outside a turn. */
export function getTurnAttributionKey(): string | undefined {
  return als.getStore()?.key
}

export function getTurnAttributionStore(): TurnAttributionStore | undefined {
  return als.getStore()
}

/** densable `Err` — clear current turn attribution key in place. */
export function clearTurnAttributionKey(): void {
  const store = als.getStore()
  if (store) {
    store.key = undefined
  }
}

/** densable `xbt` + `Pbt` — resolve UUID turn attribution key from a queued command. */
export function resolveCommandTurnAttributionKey(cmd: {
  turnAttributionKey?: unknown
  mode?: string
  inheritedTurnAttributionKey?: string
}): string | undefined {
  if (cmd.turnAttributionKey !== undefined) {
    return asUuidKey(cmd.turnAttributionKey)
  }
  return cmd.mode === 'task-notification'
    ? asUuidKey(cmd.inheritedTurnAttributionKey)
    : undefined
}

/**
 * densable `nAn` (@182147391) — resolve single non-meta prompt attribution key
 * for a drained command batch (or single inherited task-notification key).
 */
export function resolveSinglePromptAttributionKey(
  commands: ReadonlyArray<{
    uuid?: unknown
    isMeta?: boolean
    mode?: string
    turnAttributionKey?: unknown
    inheritedTurnAttributionKey?: string
  }>,
): string | undefined {
  const explicit = commands.filter(
    cmd => cmd.turnAttributionKey !== undefined && !cmd.isMeta,
  )
  if (explicit.length === 1) {
    return asUuidKey(explicit[0]?.turnAttributionKey)
  }
  if (explicit.length > 1) {
    return undefined
  }
  const nonMeta = commands.filter(cmd => !cmd.isMeta)
  if (nonMeta.length === 1) {
    return (
      resolveCommandTurnAttributionKey(nonMeta[0]!) ??
      asUuidKey(nonMeta[0]?.uuid)
    )
  }
  if (commands.length === 1) {
    return resolveCommandTurnAttributionKey(commands[0]!)
  }
  return undefined
}

/** densable `TYo` — update current store key from mid-turn absorbed commands. */
export function updateTurnAttributionFromCommands(
  commands: ReadonlyArray<{
    isMeta?: boolean
    turnAttributionKey?: unknown
  }>,
): void {
  const store = als.getStore()
  const next = commands
    .filter(cmd => !cmd.isMeta)
    .findLast(
      cmd => asUuidKey(cmd.turnAttributionKey) !== undefined,
    )?.turnAttributionKey
  if (store && typeof next === 'string') {
    store.key = next
  }
}

/**
 * densable `yk` / `rAn.run` for async generators: each `.next()`, `.return()`,
 * and `.throw()` runs inside an isolated ALS store (`wrr`) without fabricating
 * a random UUID when unset or mutating a parent turn's store object in place.
 */
export function withTurnAttributionGenerator<T, TReturn, TNext = unknown>(
  gen: AsyncGenerator<T, TReturn, TNext>,
  initialKey?: string,
): AsyncGenerator<T, TReturn, TNext> {
  const store: TurnAttributionStore = {
    key: initialKey !== undefined ? asUuidKey(initialKey) : als.getStore()?.key,
  }
  const wrapped: AsyncGenerator<T, TReturn, TNext> = {
    next: (...args) => als.run(store, () => gen.next(...args)),
    return: value => als.run(store, () => gen.return(value)),
    throw: err => als.run(store, () => gen.throw(err)),
    [Symbol.asyncIterator]() {
      return wrapped
    },
    [Symbol.asyncDispose]: async () => {
      await als
        .run(store, () => gen.return(undefined as TReturn))
        .catch(() => {})
    },
  }
  return wrapped
}
