/**
 * Official 2.1.331 single-process multi-host `AsyncLocalStorage` context
 * (`p = new AsyncLocalStorage`, `Xye`, `Ayd` / `setSessionOverridesGetter`,
 * `n()`, `h()`, and `@21221655` safe edge fallback).
 */
import { AsyncLocalStorage } from 'async_hooks'
import { realpathSync } from 'fs'
import { cwd as processCwd } from 'process'
import { randomUUID } from './crypto.js'
import { createSessionHost } from './sessionHost.js'
import {
  createRootSession,
  registerSessionContextReader,
  type Session,
} from './sessionRoot.js'

export type SubconversationStickyBetas =
  | Set<string>
  | { sent: Set<string>; rejected: Set<string> }

/**
 * Official 2.1.331 subconversation ALS store (`h()` in `01_session_root_als.js`).
 * Overrides lightweight per-subconversation fields without minting a full root
 * `Session` or `SessionHost`.
 */
export type SubconversationAlsContext = {
  session?: undefined
  sessionId?: string
  parentSessionId?: string
  originalCwd?: string
  projectRoot?: string
  sessionProjectDir?: string | null
  sdkBetas?: string[]
  cachedClaudeMdContent?: string | null
  stickyBetas?: SubconversationStickyBetas
  conversationAtisLatch?: unknown
  conversationToolsUsed?: unknown
  mainThreadAgentType?: string
  mainThreadAgentHooks?: unknown
  registeredHooks?: unknown
  sessionCronTasks?: unknown[]
  sessionCreatedTeams?: Set<string>
  pendingBranchLinks?: Map<
    string,
    { cwd: string; branch: string; attempts: number }
  >
}

/**
 * Official 2.1.331 full isolated root/fork session ALS store (`{ session }`).
 * Carries optional `subconversation` when `runWithSubconversationContext` is
 * entered inside an active `runWithSession` / `runWithNewHostSession` scope so
 * `n()` keeps the enclosing `Session` while `h()` exposes the subconversation.
 */
export type RootSessionAlsContext = {
  session: Session
  subconversation?: SubconversationAlsContext
}

export type SessionAlsContext =
  | RootSessionAlsContext
  | SubconversationAlsContext

export type NewHostSessionOptions = {
  id?: string
  parentId?: string
  cwd?: string
  originalCwd?: string
  projectRoot?: string
  isInteractive?: boolean
  diskless?: boolean
}

export type SessionAlsStorage<T> = {
  run<R>(store: T, callback: () => R): R
  exit<R>(callback: () => R): R
  getStore(): T | undefined
}

/**
 * Official `@21221655` (`globalThis.process?.getBuiltinModule?.("async_hooks")`)
 * graceful fallback when `AsyncLocalStorage` is unavailable in edge runtimes.
 */
export function createSafeAsyncLocalStorage<T>(
  AlsCtor: typeof AsyncLocalStorage | undefined = typeof AsyncLocalStorage ===
  'function'
    ? AsyncLocalStorage
    : (
        globalThis.process as unknown as {
          getBuiltinModule?: (id: string) =>
            | {
                AsyncLocalStorage?: typeof AsyncLocalStorage
              }
            | undefined
        }
      )?.getBuiltinModule?.('async_hooks')?.AsyncLocalStorage,
): SessionAlsStorage<T> {
  if (typeof AlsCtor === 'function') {
    return new AlsCtor<T>()
  }
  let fallbackStore: T | undefined
  return {
    run<R>(store: T, callback: () => R): R {
      const prev = fallbackStore
      fallbackStore = store
      try {
        return callback()
      } finally {
        fallbackStore = prev
      }
    },
    exit<R>(callback: () => R): R {
      const prev = fallbackStore
      fallbackStore = undefined
      try {
        return callback()
      } finally {
        fallbackStore = prev
      }
    },
    getStore(): T | undefined {
      return fallbackStore
    },
  }
}

export const sessionContextAls: SessionAlsStorage<SessionAlsContext> =
  createSafeAsyncLocalStorage<SessionAlsContext>()

export function getSessionAlsStore(): SessionAlsContext | undefined {
  return sessionContextAls.getStore()
}

function resolveDefaultSessionCwd(): string {
  if (typeof process === 'undefined' || typeof process.cwd !== 'function') {
    return ''
  }
  const caller = process.env.CLAUDE_CODE_CALLER_CWD?.trim()
  const raw = caller && caller.length > 0 ? caller : processCwd()
  try {
    return raw.normalize('NFC') && realpathSync(raw).normalize('NFC')
  } catch {
    return raw.normalize('NFC')
  }
}

/**
 * Run `fn` inside an isolated ALS scope bound to `session` (root or `withProject` fork).
 */
export function runWithSession<T>(session: Session, fn: () => T): T {
  return sessionContextAls.run({ session }, fn)
}

/**
 * Mint a brand-new isolated `SessionHost` + root `Session` and execute `fn(session)`
 * within its `AsyncLocalStorage` context. Concurrent calls in the same process
 * have completely independent `Session` and `SessionHost` instances.
 */
export function runWithNewHostSession<T>(
  opts: NewHostSessionOptions,
  fn: (session: Session) => T,
): T {
  const host = createSessionHost()
  if (opts.isInteractive !== undefined) {
    host.launchOptions.replaceIsInteractive(opts.isInteractive)
  }
  if (opts.diskless !== undefined) {
    host.launchOptions.replaceDiskless(opts.diskless)
  }
  const baseCwd =
    opts.originalCwd ??
    opts.cwd ??
    opts.projectRoot ??
    resolveDefaultSessionCwd()
  const originalCwd = (opts.originalCwd ?? baseCwd).normalize('NFC')
  const projectRoot = (opts.projectRoot ?? originalCwd).normalize('NFC')
  const sessionCwd = (opts.cwd ?? originalCwd).normalize('NFC')
  const session = createRootSession({
    host,
    id: opts.id ?? randomUUID(),
    parentId: opts.parentId,
    project: {
      originalCwd,
      projectRoot,
      cwd: sessionCwd,
    },
  })
  return sessionContextAls.run({ session }, () => fn(session))
}

/**
 * Run `fn` with a lightweight subconversation ALS overlay (`h()` in 2.1.331).
 * When invoked inside an active ALS `Session`, preserves that `Session` for
 * `getBootstrapSession()` (`n()`) while exposing `ctx` via `getActiveSubconversation()` (`h()`).
 */
export function runWithSubconversationContext<T>(
  ctx: SubconversationAlsContext,
  fn: () => T,
): T {
  const outerSession = sessionContextAls.getStore()?.session
  if (outerSession !== undefined) {
    return sessionContextAls.run(
      { session: outerSession, subconversation: ctx },
      fn,
    )
  }
  return sessionContextAls.run(ctx, fn)
}

/**
 * Temporarily exit any active ALS session/subconversation context (`als.exit(fn)`),
 * falling back to the process-default `bootstrapSession` for the duration of `fn`.
 */
export function exitSessionContext<T>(fn: () => T): T {
  return sessionContextAls.exit(fn)
}

/**
 * Return the active `Session` from ALS when inside `runWithSession` /
 * `runWithNewHostSession`, or `undefined` otherwise.
 */
export function getActiveSessionFromAls(): Session | undefined {
  return sessionContextAls.getStore()?.session
}

/**
 * Official `h()` — return the active `SubconversationAlsContext` when inside
 * `runWithSubconversationContext`, or `undefined` when in default or `{ session }` mode.
 */
export function getActiveSubconversationFromAls():
  | SubconversationAlsContext
  | undefined {
  const store = sessionContextAls.getStore()
  if (!store) return undefined
  return store.session ? store.subconversation : store
}

/**
 * Official `Xye()` (`p.getStore() !== void 0`) — true when an ALS session or
 * subconversation context is active on the current async execution chain.
 */
export function hasActiveSessionAls(): boolean {
  return sessionContextAls.getStore() !== undefined
}

/**
 * Official 2.1.331 `o7()` — true when running in multi-host shared-backend mode
 * (default `false` in plain CLI; enabled via ref-counted leases from hosts/ACP
 * or toggled explicitly by tests via `setSharedBackendMode`).
 */
let sharedBackendLeaseCount = 0
let explicitSharedBackendOverride: boolean | undefined

export function isSharedBackend(): boolean {
  return explicitSharedBackendOverride === true || sharedBackendLeaseCount > 0
}

export function setSharedBackendMode(enabled: boolean): void {
  explicitSharedBackendOverride = enabled ? true : undefined
}

/**
 * Acquire a ref-counted lease enabling shared-backend mode (`isSharedBackend() === true`).
 * Returns an idempotent release function that decrements only this caller's lease
 * so concurrent subsystems (e.g., `EmbeddedHost` and multi-session `AcpAgent`)
 * never clobber one another's shared-backend state.
 */
export function acquireSharedBackendMode(): () => void {
  sharedBackendLeaseCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    sharedBackendLeaseCount = Math.max(0, sharedBackendLeaseCount - 1)
  }
}

// Automatically wire `registerSessionContextReader` (`Ayd`) on import so
// `sessionRoot.ts` (`getBootstrapSession` / `getActiveSubconversation`) reads ALS seamlessly.
registerSessionContextReader(getSessionAlsStore)
