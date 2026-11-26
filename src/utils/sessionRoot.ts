/**
 * Official `yGt` / `en` / `un` / `n()` @178531733 / @178531824 / @178548313 / @178548576.
 * Leftover Session is official S. host is leftover SessionHost (official Ke).
 */
import { createHash } from 'crypto'
import { realpathSync } from 'fs'
import { cwd } from 'process'
import { randomUUID } from './crypto.js'
import { HostSlot, RootSessionSlot } from './hostSlot.js'
import {
  exitSessionContext,
  getActiveSessionFromAls,
  getActiveSubconversationFromAls,
  getSessionAlsStore,
  hasActiveSessionAls,
  isSharedBackend,
  type NewHostSessionOptions,
  type RootSessionAlsContext,
  runWithNewHostSession,
  runWithSession,
  runWithSubconversationContext,
  type SessionAlsContext,
  sessionContextAls,
  setSharedBackendMode,
  type SubconversationAlsContext,
  type SubconversationStickyBetas,
} from './sessionContextAls.js'
import { createSessionHost, type SessionHost } from './sessionHost.js'
import {
  AutonomousLoopPreamble,
  BtwHistory,
  CcrRecap,
  ConversationLatches,
  CostLedger,
  EngineStore,
  FableConsentSlots,
  HookRegistry,
  InvokedSkills,
  McpSessionWiring,
  ModelSelection,
  PendingHint,
  PluginsSync,
  Precompute,
  PromptAssembly,
  PromptSuggestion,
  RequestJournal,
  SessionCron,
  SessionFlags,
  SessionIdentity,
  SessionObservers,
  SessionOnceLatches,
  SessionRefsGate,
  SessionScratch,
  SurfaceCapabilities,
  ToolProgressThrottle,
  TurnBudget,
  UserPresence,
  WorkflowUsageConsent,
  WritePermissionStash,
} from './sessionSlots.js'
import { createSignal, type Signal } from './signal.js'

export {
  EngineStore,
  exitSessionContext,
  getActiveSessionFromAls,
  getActiveSubconversationFromAls,
  getSessionAlsStore,
  hasActiveSessionAls,
  HostSlot,
  isSharedBackend,
  type NewHostSessionOptions,
  type RootSessionAlsContext,
  RootSessionSlot,
  runWithNewHostSession,
  runWithSession,
  runWithSubconversationContext,
  type SessionAlsContext,
  sessionContextAls,
  setSharedBackendMode,
  type SubconversationAlsContext,
  type SubconversationStickyBetas,
}

function nfcPath(e: string): string {
  return e.normalize('NFC')
}

/** Official Z @178495915 — namespace for i7. */
const REMOTE_SESSION_NAMESPACE = '3ab19d7e-9f35-45c2-926e-75e271cc60b3'

/**
 * Official i7 @178495421.
 * `function i7(e,t){… sha1 namespace+name … UUID}`
 */
function namespacedSessionId(e: string, t: string): string {
  const o = Buffer.from(t.replace(/-/g, ''), 'hex')
  const r = createHash('sha1').update(o).update(Buffer.from(e, 'utf8')).digest()
  r[6] = (r[6] & 15) | 80
  r[8] = (r[8] & 63) | 128
  const i = r.subarray(0, 16).toString('hex')
  return `${i.slice(0, 8)}-${i.slice(8, 12)}-${i.slice(12, 16)}-${i.slice(16, 20)}-${i.slice(20, 32)}`
}

function isEnvTruthyLocal(value: string | undefined): boolean {
  if (!value) return false
  const norm = value.trim().toLowerCase()
  return norm === '1' || norm === 'true' || norm === 'yes' || norm === 'on'
}

/**
 * Official avt @178495998 sha=9a39cc0b3ca7bb29
 * `function avt(){let e=process.env.CLAUDE_CODE_REMOTE_SESSION_ID?.trim();return e?i7(e,Z):null}`
 */
function remoteSessionId(): string | null {
  const e = process.env.CLAUDE_CODE_REMOTE_SESSION_ID?.trim()
  return e ? namespacedSessionId(e, REMOTE_SESSION_NAMESPACE) : null
}

/**
 * Official `J4a` (#1536/#1582/#1583): child session without `--sdk-url` or
 * `mcp serve` must not inherit the parent's `CLAUDE_CODE_REMOTE_SESSION_ID`.
 */
export function isChildSessionWithoutSdkUrl(
  argv: readonly string[] = process.argv ?? [],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const rawRemote = env.CLAUDE_CODE_REMOTE_SESSION_ID?.trim()
  if (!isEnvTruthyLocal(env.CLAUDE_CODE_CHILD_SESSION) || !rawRemote) {
    return false
  }
  const dashDashIdx = argv.indexOf('--')
  const head = argv.slice(0, dashDashIdx === -1 ? undefined : dashDashIdx)
  const hasSdkUrl = head.some((arg, idx) =>
    arg === '--sdk-url'
      ? Boolean(head[idx + 1])
      : arg.startsWith('--sdk-url=') && arg !== '--sdk-url=',
  )
  return !hasSdkUrl && !(argv[2] === 'mcp' && argv[3] === 'serve')
}

/**
 * Official `gor`: returns `null` when running as an isolated child session
 * unless `CLAUDE_CODE_DISABLE_NESTED_SESSION_ID` is truthy.
 */
export function isolatedRemoteSessionId(
  argv: readonly string[] = process.argv ?? [],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.CLAUDE_CODE_REMOTE_SESSION_ID?.trim()
  const remoteId = raw
    ? namespacedSessionId(raw, REMOTE_SESSION_NAMESPACE)
    : null
  if (remoteId === null) return null
  if (
    isChildSessionWithoutSdkUrl(argv, env) &&
    !isEnvTruthyLocal(env.CLAUDE_CODE_DISABLE_NESTED_SESSION_ID)
  ) {
    return null
  }
  return remoteId
}

export type SessionProject = {
  readonly originalCwd: string
  readonly projectRoot: string
  readonly cwd: string
  readonly isolationRoot?: string | null
}

export type Session = {
  host: SessionHost
  readonly id: string
  readonly parentId: string | undefined
  readonly root: Session
  project: SessionProject
  observers: SessionObservers
  autonomousLoopPreamble: AutonomousLoopPreamble
  btwHistory: BtwHistory
  ccrRecap: CcrRecap
  conversationLatches: ConversationLatches
  costLedger: CostLedger
  engineStore: EngineStore
  fableConsentSlots: FableConsentSlots
  hookRegistry: HookRegistry
  identity: SessionIdentity
  invokedSkills: InvokedSkills
  mcpSessionWiring: McpSessionWiring
  modelSelection: ModelSelection
  promptAssembly: PromptAssembly
  promptSuggestion: PromptSuggestion
  pendingHint: PendingHint
  pluginsSync: PluginsSync
  precompute: Precompute
  requestJournal: RequestJournal
  sessionCron: SessionCron
  sessionFlags: SessionFlags
  sessionRefsGate: SessionRefsGate
  sessionScratch: SessionScratch
  readonly onceLatches: SessionOnceLatches
  surfaceCapabilities: SurfaceCapabilities
  toolProgressThrottle: ToolProgressThrottle
  turnBudget: TurnBudget
  userPresence: UserPresence
  workflowUsageConsent: WorkflowUsageConsent
  writePermissionStash: WritePermissionStash
  subscribe(d: () => void): () => void
  setCwd(d: string): void
  setIsolationRoot(d: string | null | undefined): void
  withProject(d: Partial<SessionProject>): Session
  update(d: {
    id?: string
    parentId?: string | undefined
    project?: Partial<SessionProject>
  }): void
}

type SessionKind =
  | {
      kind: 'root'
      host: SessionHost
      id: string
      parentId?: string
    }
  | { kind: 'fork'; root: Session }

/**
 * Official en @178531824 sha=379ff8dd5d0d4188
 */
export function bindSession(
  e: SessionKind,
  t: SessionProject,
  isolationRoot?: string | null,
): Session {
  let o = nfcPath(t.originalCwd)
  let r = nfcPath(t.projectRoot)
  let i = nfcPath(t.cwd)
  let isoRoot: string | null | undefined =
    isolationRoot !== undefined ? isolationRoot : t.isolationRoot
  const s = createSignal()
  const a = e.kind === 'fork' ? e.root.observers : new SessionObservers()
  const l =
    e.kind === 'fork'
      ? e.root.autonomousLoopPreamble
      : new AutonomousLoopPreamble()
  const p = e.kind === 'fork' ? e.root.precompute : new Precompute()
  const u = {
    get originalCwd() {
      return o
    },
    get projectRoot() {
      return r
    },
    get cwd() {
      return i
    },
    get isolationRoot() {
      return isoRoot
    },
  }
  let id = e.kind === 'fork' ? e.root.id : e.id
  let parentId = e.kind === 'fork' ? e.root.parentId : e.parentId
  const S: Session = {
    host: e.kind === 'fork' ? e.root.host : e.host,
    get id() {
      return e.kind === 'fork' ? e.root.id : id
    },
    get parentId() {
      return e.kind === 'fork' ? e.root.parentId : parentId
    },
    get root() {
      return e.kind === 'fork' ? e.root : S
    },
    project: u,
    observers: a,
    autonomousLoopPreamble: l,
    btwHistory: e.kind === 'fork' ? e.root.btwHistory : new BtwHistory(),
    ccrRecap: e.kind === 'fork' ? e.root.ccrRecap : new CcrRecap(),
    conversationLatches:
      e.kind === 'fork'
        ? e.root.conversationLatches
        : new ConversationLatches(),
    costLedger: e.kind === 'fork' ? e.root.costLedger : new CostLedger(),
    engineStore: e.kind === 'fork' ? e.root.engineStore : new EngineStore(),
    fableConsentSlots:
      e.kind === 'fork' ? e.root.fableConsentSlots : new FableConsentSlots(),
    hookRegistry: e.kind === 'fork' ? e.root.hookRegistry : new HookRegistry(),
    identity: e.kind === 'fork' ? e.root.identity : new SessionIdentity(),
    invokedSkills:
      e.kind === 'fork' ? e.root.invokedSkills : new InvokedSkills(),
    mcpSessionWiring:
      e.kind === 'fork' ? e.root.mcpSessionWiring : new McpSessionWiring(),
    modelSelection:
      e.kind === 'fork' ? e.root.modelSelection : new ModelSelection(),
    promptAssembly:
      e.kind === 'fork' ? e.root.promptAssembly : new PromptAssembly(),
    promptSuggestion:
      e.kind === 'fork' ? e.root.promptSuggestion : new PromptSuggestion(),
    pendingHint: e.kind === 'fork' ? e.root.pendingHint : new PendingHint(),
    pluginsSync: e.kind === 'fork' ? e.root.pluginsSync : new PluginsSync(),
    precompute: p,
    requestJournal:
      e.kind === 'fork' ? e.root.requestJournal : new RequestJournal(),
    sessionCron: e.kind === 'fork' ? e.root.sessionCron : new SessionCron(),
    sessionFlags: e.kind === 'fork' ? e.root.sessionFlags : new SessionFlags(),
    sessionRefsGate:
      e.kind === 'fork' ? e.root.sessionRefsGate : new SessionRefsGate(),
    sessionScratch:
      e.kind === 'fork' ? e.root.sessionScratch : new SessionScratch(),
    get onceLatches() {
      return sessionOnceLatchBag.of(S)
    },
    surfaceCapabilities:
      e.kind === 'fork'
        ? e.root.surfaceCapabilities
        : new SurfaceCapabilities(),
    toolProgressThrottle:
      e.kind === 'fork'
        ? e.root.toolProgressThrottle
        : new ToolProgressThrottle(),
    turnBudget: e.kind === 'fork' ? e.root.turnBudget : new TurnBudget(),
    userPresence: e.kind === 'fork' ? e.root.userPresence : new UserPresence(),
    workflowUsageConsent:
      e.kind === 'fork'
        ? e.root.workflowUsageConsent
        : new WorkflowUsageConsent(),
    writePermissionStash:
      e.kind === 'fork'
        ? e.root.writePermissionStash
        : new WritePermissionStash(),
    subscribe(d) {
      const c = s.subscribe(d)
      if (e.kind !== 'fork') return c
      const f = e.root
      let m = f.id
      let b = f.parentId
      const y = f.subscribe(() => {
        if (f.id === m && f.parentId === b) return
        m = f.id
        b = f.parentId
        d()
      })
      return () => {
        c()
        y()
      }
    },
    setCwd(d) {
      S.update({ project: { cwd: d } })
    },
    setIsolationRoot(d) {
      if (d !== isoRoot) {
        isoRoot = d
        s.emit()
      }
    },
    withProject(d) {
      const nextIsolationRoot =
        d.isolationRoot !== undefined ? d.isolationRoot : isoRoot
      return bindSession(
        { kind: 'fork', root: S.root },
        {
          originalCwd: d.originalCwd ?? o,
          projectRoot: d.projectRoot ?? r,
          cwd: d.cwd ?? i,
          isolationRoot: nextIsolationRoot,
        },
        nextIsolationRoot,
      )
    },
    update(d) {
      let c = false
      if (d.id !== undefined || 'parentId' in d) {
        if (e.kind === 'fork') {
          throw new Error(
            'A withProject fork cannot re-identify the session — update the root session instead',
          )
        }
        if (d.id !== undefined && d.id !== id) {
          id = d.id
          c = true
        }
        if ('parentId' in d && d.parentId !== parentId) {
          parentId = d.parentId
          c = true
        }
      }
      const f = d.project
      if (f) {
        if (f.originalCwd !== undefined) {
          const m = nfcPath(f.originalCwd)
          if (m !== o) {
            o = m
            c = true
          }
        }
        if (f.projectRoot !== undefined) {
          const m = nfcPath(f.projectRoot)
          if (m !== r) {
            r = m
            c = true
          }
        }
        if (f.cwd !== undefined) {
          const m = nfcPath(f.cwd)
          if (m !== i) {
            i = m
            c = true
          }
        }
        if (f.isolationRoot !== undefined && f.isolationRoot !== isoRoot) {
          isoRoot = f.isolationRoot
          c = true
        }
      }
      if (c) s.emit()
    },
  }
  return S
}

/**
 * Official yGt @178531733
 * `function yGt(e){return en({kind:"root",host:e.host,id:e.id,parentId:e.parentId},e.project)}`
 */
export function createRootSession(e: {
  host: SessionHost
  id: string
  parentId?: string
  project: SessionProject
}): Session {
  return bindSession(
    { kind: 'root', host: e.host, id: e.id, parentId: e.parentId },
    e.project,
  )
}

/**
 * Official un @178548313 sha=a9fa0bdb5650afc5
 */
export function createBootstrapSession(): Session {
  let e = ''
  if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
    // bun scripts/dev.ts pins spawn cwd to the repo; SDK/caller's directory
    // is CLAUDE_CODE_CALLER_CWD. Official binary has no wrapper pin.
    const caller = process.env.CLAUDE_CODE_CALLER_CWD?.trim()
    const t = caller && caller.length > 0 ? caller : cwd()
    try {
      e = nfcPath(realpathSync(t))
    } catch {
      e = nfcPath(t)
    }
  }
  return createRootSession({
    host: createSessionHost(),
    id: isolatedRemoteSessionId() ?? randomUUID(),
    project: { originalCwd: e, projectRoot: e, cwd: e },
  })
}

export type SessionContextReader = () => SessionAlsContext | undefined

function sessionContextReaderSlot(): {
  reader: SessionContextReader | undefined
} {
  const holder = sessionContextReaderSlot as unknown as {
    slot?: { reader: SessionContextReader | undefined }
  }
  return (holder.slot ??= { reader: undefined })
}

/**
 * Official 2.1.331 `Ayd` (`setSessionOverridesGetter`):
 * `var b; function Ayd(e){b=e}`
 */
export function registerSessionContextReader(
  reader: SessionContextReader | undefined,
): void {
  sessionContextReaderSlot().reader = reader
}

export const setSessionOverridesGetter = registerSessionContextReader

let bootstrapSession: Session | undefined

function getDefaultBootstrapSession(): Session {
  return (bootstrapSession ??= createBootstrapSession())
}

/**
 * Official n() @178548576 `function n(){return C()?.session??v}`.
 * Official 2.1.331: `function N(){return n()} function n(){return b?.()?.session??y}`.
 */
export function getBootstrapSession(): Session {
  const sessionContextReader = sessionContextReaderSlot().reader
  return (
    sessionContextReader?.()?.session ??
    (bootstrapSession ??= createBootstrapSession())
  )
}

/** Official k.host / n().host */
export function getBootstrapSessionHost(): SessionHost {
  return getBootstrapSession().host
}

/**
 * Official 2.1.331 `Do(e)` (`function Do(e){return e.of(y.host)}`):
 * Resolves a `HostSlot` against the process-default bootstrap `SessionHost`.
 */
export function ofDefaultHost<T>(slot: { of(host: SessionHost): T }): T {
  return slot.of(getDefaultBootstrapSession().host)
}

/**
 * Official 2.1.331 `h()` (`function h(){let e=b?.();return e?.session?void 0:e}`):
 * Returns the active subconversation ALS overlay when present, or `undefined`
 * when running in the default session or a full `{ session }` ALS context.
 */
export function getActiveSubconversation():
  | SubconversationAlsContext
  | undefined {
  const store = sessionContextReaderSlot().reader?.()
  if (!store) return undefined
  return store.session ? store.subconversation : store
}

/** densable `jt = new Ln(() => new Ge)` */
const sessionOnceLatchBag = new RootSessionSlot(() => new SessionOnceLatches())

/** Official 2.1.331 `bt = new $e(() => Ue())` — per-root-session switch signal. */
const sessionSwitchSignalBag = new RootSessionSlot(() =>
  createSignal<[id: string, reason?: string, payload?: unknown]>(),
)

/** Official 2.1.331 `bt.of(session)` — forks share the root session's switch signal. */
export function getSessionSwitchSignal(
  session: Session = getBootstrapSession(),
): Signal<[id: string, reason?: string, payload?: unknown]> {
  return sessionSwitchSignalBag.of(session)
}

/**
 * densable `Du()` — `jt.of(G())`. `G()` is `n()` (bootstrap session).
 */
export function getSessionOnceLatches(): SessionOnceLatches {
  return sessionOnceLatchBag.of(getBootstrapSession())
}

/** densable `jt.of(session)` — forks share the root bag. */
export function sessionOnceLatchesOf(session: Session): SessionOnceLatches {
  return sessionOnceLatchBag.of(session)
}

/**
 * densable `i5n` body — skip `cd`/`hydrate`, else
 * `Du().resetStreamNoEventsWarningLatch()`.
 */
export function resetOnceLatchesOnSessionSwitch(
  _id: string,
  reason?: string,
): void {
  if (reason === 'cd' || reason === 'hydrate') return
  getSessionOnceLatches().resetStreamNoEventsWarningLatch()
}

export function resetSessionHostForTests(): void {
  if (bootstrapSession) {
    sessionOnceLatchBag.drop(bootstrapSession)
    sessionSwitchSignalBag.drop(bootstrapSession)
  }
  bootstrapSession = undefined
}

/** densable `session.host` / `k.host`. */
export function getReplDiffHost(): object {
  return getBootstrapSessionHost()
}
