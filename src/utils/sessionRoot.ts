/**
 * Official `yGt` / `en` / `un` / `n()` @178531733 / @178531824 / @178548313 / @178548576.
 * Leftover Session is official S. host is leftover SessionHost (official Ke).
 */
import { createHash } from 'crypto'
import { realpathSync } from 'fs'
import { cwd } from 'process'
import { randomUUID } from './crypto.js'
import { createSessionHost, type SessionHost } from './sessionHost.js'
import {
  AutonomousLoopPreamble,
  BtwHistory,
  CcrRecap,
  ConversationLatches,
  CostLedger,
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
  SessionRefsGate,
  SessionOnceLatches,
  SessionScratch,
  SurfaceCapabilities,
  ToolProgressThrottle,
  TurnBudget,
  UserPresence,
  WorkflowUsageConsent,
  WritePermissionStash,
} from './sessionSlots.js'
import { createSignal } from './signal.js'

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

/**
 * Official avt @178495998 sha=9a39cc0b3ca7bb29
 * `function avt(){let e=process.env.CLAUDE_CODE_REMOTE_SESSION_ID?.trim();return e?i7(e,Z):null}`
 */
function remoteSessionId(): string | null {
  const e = process.env.CLAUDE_CODE_REMOTE_SESSION_ID?.trim()
  return e ? namespacedSessionId(e, REMOTE_SESSION_NAMESPACE) : null
}

export type SessionProject = {
  readonly originalCwd: string
  readonly projectRoot: string
  readonly cwd: string
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
  surfaceCapabilities: SurfaceCapabilities
  toolProgressThrottle: ToolProgressThrottle
  turnBudget: TurnBudget
  userPresence: UserPresence
  workflowUsageConsent: WorkflowUsageConsent
  writePermissionStash: WritePermissionStash
  subscribe(d: () => void): () => void
  setCwd(d: string): void
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
export function bindSession(e: SessionKind, t: SessionProject): Session {
  let o = nfcPath(t.originalCwd)
  let r = nfcPath(t.projectRoot)
  let i = nfcPath(t.cwd)
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
    withProject(d) {
      return bindSession(
        { kind: 'fork', root: S.root },
        {
          originalCwd: d.originalCwd ?? o,
          projectRoot: d.projectRoot ?? r,
          cwd: d.cwd ?? i,
        },
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
    const t = cwd()
    try {
      e = nfcPath(realpathSync(t))
    } catch {
      e = nfcPath(t)
    }
  }
  return createRootSession({
    host: createSessionHost(),
    id: remoteSessionId() ?? randomUUID(),
    project: { originalCwd: e, projectRoot: e, cwd: e },
  })
}

let bootstrapSession: Session | undefined

/** Official n() @178548576 `function n(){return C()?.session??v}` — leftover C() empty. */
export function getBootstrapSession(): Session {
  return (bootstrapSession ??= createBootstrapSession())
}

/** Official k.host */
export function getBootstrapSessionHost(): SessionHost {
  return getBootstrapSession().host
}

/**
 * densable `Ln` — WeakMap keyed on `session.root`.
 * Gold: `of(e){let t=e.root,o=this.#t.get(t);if(o!==void 0)return o;let r=this.#e();return this.#t.set(t,r),r}`
 */
class RootKeyedBag<T extends object> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  peek(e: { root: object }): T | undefined {
    return this.#t.get(e.root)
  }
  of(e: { root: object }): T {
    const t = e.root
    const o = this.#t.get(t)
    if (o !== undefined) return o
    const r = this.#e()
    this.#t.set(t, r)
    return r
  }
  drop(e: { root: object }): void {
    this.#t.delete(e.root)
  }
}

/** densable `jt = new Ln(() => new Ge)` */
const sessionOnceLatchBag = new RootKeyedBag(() => new SessionOnceLatches())

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
  if (bootstrapSession) sessionOnceLatchBag.drop(bootstrapSession)
  bootstrapSession = undefined
}

/** densable `session.host` / `k.host`. */
export function getReplDiffHost(): object {
  return getBootstrapSessionHost()
}
