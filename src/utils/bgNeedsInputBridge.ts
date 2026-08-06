/**
 * densable 2.1.212 `Vce` / `a7u` / `msf` — background job needs-input bridge.
 *
 * REPL dialogs (sandbox network allow, worker-sandbox, MCP elicitation,
 * managed-settings security review, permission prompts) emit a needs string.
 * When running as a bg worker (`CLAUDE_JOB_DIR` / job short), the bridge writes
 * `tempo: blocked` + `needs` into the job state.json so FleetView / agents
 * --json show **Needs input**.
 *
 * Priority (densable j3g):
 *   sandbox > worker-sandbox > elicitation > managed-settings > permission > dialog
 */

export type BgNeedsSource =
  | 'sandbox'
  | 'worker-sandbox'
  | 'elicitation'
  | 'managed-settings'
  | 'permission'
  | 'dialog'

export type BgNeedsPayload = {
  text: string
  questions?: Array<{ question: string; options?: Array<{ label: string }> }>
}

const SOURCE_PRIORITY: readonly BgNeedsSource[] = [
  'sandbox',
  'worker-sandbox',
  'elicitation',
  'managed-settings',
  'permission',
  'dialog',
]

type Slot = BgNeedsPayload | null

const slots: Record<BgNeedsSource, Slot> = {
  sandbox: null,
  'worker-sandbox': null,
  elicitation: null,
  'managed-settings': null,
  permission: null,
  dialog: null,
}

let lastEmitted: BgNeedsPayload | null = null
const listeners = new Set<(payload: BgNeedsPayload | null) => void>()

function recompute(): void {
  let next: BgNeedsPayload | null = null
  for (const src of SOURCE_PRIORITY) {
    const s = slots[src]
    if (s) {
      next = s
      break
    }
  }
  if (next?.text === lastEmitted?.text) return
  lastEmitted = next
  for (const fn of listeners) fn(next)
}

/**
 * densable Vce.emit(text|null, source).
 * Pass null to clear that source slot.
 */
export function emitBgNeedsInput(
  text: string | null,
  source: BgNeedsSource = 'permission',
  extra?: Omit<BgNeedsPayload, 'text'>,
): void {
  const next: Slot =
    text === null || text === '' ? null : { text, questions: extra?.questions }
  if (slots[source]?.text === next?.text) return
  slots[source] = next
  recompute()
}

export function subscribeBgNeedsInput(
  listener: (payload: BgNeedsPayload | null) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getBgNeedsInputSnapshot(): BgNeedsPayload | null {
  return lastEmitted
}

/** densable Fi — true when this process is a bg job worker. */
export function isBgJobSession(): boolean {
  return (
    process.env.CLAUDE_CODE_SESSION_KIND === 'bg' ||
    Boolean(process.env.CLAUDE_JOB_DIR)
  )
}

/** densable strings — keep exact. */
export function formatSandboxNeeds(host: string): string {
  return `allow network: ${host}`
}
export function formatMcpElicitationNeeds(server: string): string {
  return `MCP input: ${server}`
}
export const MANAGED_SETTINGS_NEEDS = 'review: managed settings change'
export const MCP_URL_ELICITATION_NEEDS = 'MCP input: open link'

/**
 * densable UIb — top-level dialog kind → needs text (msf dialog source).
 * Keys match printRequestDialog / userDialog kind registry.
 */
export const DIALOG_NEEDS_BY_KIND: Readonly<Record<string, string>> = {
  refusal_fallback_prompt: 'choose: retry on fallback model or edit prompt',
  fable_overage_consent_prompt:
    'choose: continue Fable 5 on usage credits or switch models',
  mcp_url_elicitation: MCP_URL_ELICITATION_NEEDS,
}

/** densable Eqo→UIb emit for dialog slot. Pass null/unknown kind to clear. */
export function emitBgNeedsFromDialogKind(
  kind: string | null | undefined,
): void {
  if (!kind) {
    emitBgNeedsInput(null, 'dialog')
    return
  }
  const text = DIALOG_NEEDS_BY_KIND[kind]
  emitBgNeedsInput(text ?? null, 'dialog')
}

/**
 * densable P1u — permission prompt needs text for job state / agents --json.
 * ExitPlanMode → "approve plan"; else "approve {tool}" or "approve {tool}: {detail}".
 */
export function formatPermissionNeeds(opts: {
  toolName: string
  userFacingName?: string
  input?: Record<string, unknown> | null
}): string {
  const toolName = opts.toolName
  if (
    toolName === 'ExitPlanMode' ||
    toolName === 'exit_plan_mode' ||
    toolName === 'ExitPlanModeV2'
  ) {
    return 'approve plan'
  }
  const t = opts.input ?? undefined
  const r = (opts.userFacingName ?? toolName).trim()
  const n =
    typeof t?.command === 'string'
      ? t.command
      : typeof t?.file_path === 'string'
        ? t.file_path
        : typeof t?.url === 'string'
          ? t.url
          : ''
  const o = r || toolName
  if (n && !o.includes(n)) {
    const full = `approve ${o}: ${n}`
    // densable H8r — keep fleet needs string short for state.json / list
    return full.length > 120 ? `${full.slice(0, 117)}…` : full
  }
  return `approve ${o}`
}

/**
 * densable t7r / tDt / ihs — in-flight registry stamped on a7u/u7u writes.
 * shs(e) replaces the snapshot and emits so c7u→u7u can patch fan/budget/inFlight.
 */
export type BgInFlightSnapshot = {
  tasks: number
  queued: number
  kinds: string[]
  /** densable t7r.items — fan-out items when present */
  items?: Array<Record<string, unknown>>
  budget?: unknown
}

let t7r: BgInFlightSnapshot = { tasks: 0, queued: 0, kinds: [], items: [] }
const ihsListeners = new Set<() => void>()

/** densable tDt() */
export function snapshotInFlight(): {
  tasks: number
  queued: number
  kinds: string[]
} {
  return { tasks: t7r.tasks, queued: t7r.queued, kinds: [...t7r.kinds] }
}

/** densable Ror() — full registry clone for u7u fan/budget compare */
export function getBgInFlightRegistry(): BgInFlightSnapshot {
  return {
    tasks: t7r.tasks,
    queued: t7r.queued,
    kinds: [...t7r.kinds],
    // densable t7r always has items:[] (not undefined)
    items: t7r.items ? [...t7r.items] : [],
    budget: t7r.budget,
  }
}

/**
 * densable shs(e) — **full replace** `t7r=e` then ihs.emit (not Partial merge).
 * Callers (JFa / framework stamp) must pass a complete snapshot; omitted
 * items → []; omitted budget → cleared (void 0).
 */
export function setBgInFlightRegistry(next: BgInFlightSnapshot): void {
  t7r = {
    tasks: next.tasks,
    queued: next.queued,
    kinds: [...(next.kinds ?? [])],
    items: next.items ? [...next.items] : [],
    budget: next.budget,
  }
  for (const l of ihsListeners) {
    try {
      l()
    } catch {
      // ignore listener errors
    }
  }
}

/** densable ihs.subscribe */
export function subscribeBgInFlight(listener: () => void): () => void {
  ihsListeners.add(listener)
  return () => {
    ihsListeners.delete(listener)
  }
}

/** Test / reset helper */
export function resetBgInFlightRegistry(): void {
  t7r = { tasks: 0, queued: 0, kinds: [], items: [] }
}

/**
 * densable a7u — write needs into job state when CLAUDE_JOB_DIR is set.
 * Safe no-op outside bg worker sessions.
 * densable double-reads state before write (race with concurrent patches).
 */
export async function writeBgNeedsToJobState(
  payload: BgNeedsPayload | null,
): Promise<void> {
  const jobDir = process.env.CLAUDE_JOB_DIR
  if (!jobDir) return
  const short = process.env.CLAUDE_BG_SHORT
  try {
    const { readBgJobState, writeBgJobState, getJobDirPath } = await import(
      '../daemon/jobState.js'
    )
    // Prefer explicit short; else basename of job dir (jobs/<short>).
    const id =
      short ||
      jobDir
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ||
      ''
    if (!id) return
    // Ensure we read the same dir densable uses (nc(short)).
    void getJobDirPath
    const first = readBgJobState(id)
    if (!first) return
    // densable dF: do not overwrite terminal states with needs.
    if (
      first.state === 'done' ||
      first.state === 'failed' ||
      first.state === 'stopped' ||
      first.state === 'crashed'
    ) {
      return
    }
    const needs = payload?.text ?? undefined
    if (needs) {
      if (first.tempo === 'blocked' && first.needs === needs) return
    } else if (first.tempo !== 'blocked') {
      return
    }
    // densable a7u: re-read before write (another bridge hop may have raced)
    const current = readBgJobState(id) ?? first
    if (
      current.state === 'done' ||
      current.state === 'failed' ||
      current.state === 'stopped' ||
      current.state === 'crashed'
    ) {
      return
    }
    if (needs) {
      if (current.tempo === 'blocked' && current.needs === needs) return
    } else if (current.tempo !== 'blocked') {
      return
    }
    const tempo = needs ? 'blocked' : 'active'
    // Map optional option shapes onto jobState.block (description required there).
    const block = payload?.questions
      ? {
          questions: payload.questions.map(q => ({
            question: q.question,
            options: (q.options ?? []).map(o => ({
              label: o.label,
              description: '',
            })),
          })),
        }
      : undefined
    writeBgJobState(id, {
      ...current,
      tempo,
      // densable a7u stamps inFlight via tDt() on every needs write
      inFlight: snapshotInFlight(),
      needs: needs,
      block,
      suggestedReply: undefined,
      updatedAt: new Date().toISOString(),
    })
  } catch {
    // never throw into UI path
  }
}

/**
 * densable c7u worker bridge state — permissionBridgeSubscribed + bridgeWriteChain
 * + optional inFlight await before each write (serialize with concurrent patches).
 */
type BgNeedsBridgeState = {
  permissionBridgeSubscribed: boolean
  bridgeWriteChain: Promise<void>
  /** densable e.inFlight — optional promise awaited before each a7u write. */
  inFlight?: Promise<void> | null
}

const bridgeState: BgNeedsBridgeState = {
  permissionBridgeSubscribed: false,
  bridgeWriteChain: Promise.resolve(),
  inFlight: null,
}

/**
 * densable Tmo — worktree session bus (hne → Tmo.emit → c7u → l7u).
 * Payload null clears worktree fields on job state.
 */
export type BgWorktreeMeta = {
  worktreePath?: string
  worktreeBranch?: string
  worktreeHookBased?: boolean
  /** densable enteredExisting → clear path fields */
  enteredExisting?: boolean
} | null

const tmoListeners = new Set<(meta: BgWorktreeMeta) => void>()
let lastTmo: BgWorktreeMeta = null

/** densable Tmo.emit */
export function emitBgWorktreeMeta(meta: BgWorktreeMeta): void {
  lastTmo = meta
  for (const fn of tmoListeners) {
    try {
      fn(meta)
    } catch {
      // ignore
    }
  }
}

/** densable Tmo.subscribe */
export function subscribeBgWorktreeMeta(
  listener: (meta: BgWorktreeMeta) => void,
): () => void {
  tmoListeners.add(listener)
  return () => {
    tmoListeners.delete(listener)
  }
}

export function getBgWorktreeMetaSnapshot(): BgWorktreeMeta {
  return lastTmo
}

/** densable Jat — stable compare key for fan items */
export function fanItemsKey(
  items: Array<Record<string, unknown>> | undefined | null,
): string {
  if (!items || items.length === 0) return ''
  return items
    .map(t => {
      const id = (t.id ?? t.label ?? '') as string | number
      const doneAt = (t.doneAt ?? '-') as string | number
      const failed = t.failed ? 'x' : ''
      const r = `${id}:${doneAt}:${failed}`
      return t.kind === 'todo'
        ? `${r}:${(t.startedAt ?? '-') as string | number}`
        : r
    })
    .join('|')
}

/** densable Xat — budget progress bucket (20ths); -1 when no target */
export function budgetProgressKey(
  budget: { spent?: number; target?: number } | null | undefined,
): number {
  if (!budget || !(typeof budget.target === 'number') || budget.target <= 0) {
    return -1
  }
  const spent = typeof budget.spent === 'number' ? budget.spent : 0
  return Math.floor((20 * spent) / budget.target)
}

/**
 * densable l7r — merge worktree meta onto job fields (null/enteredExisting clears).
 */
export function mergeWorktreeMetaForJob(
  meta: BgWorktreeMeta,
  current?: {
    worktreePath?: string
    worktreeBranch?: string
    worktreeHookBased?: boolean
  },
): {
  worktreePath?: string
  worktreeBranch?: string
  worktreeHookBased?: boolean
} {
  if (meta === undefined) {
    return {
      worktreePath: current?.worktreePath,
      worktreeBranch: current?.worktreeBranch,
      worktreeHookBased: current?.worktreeHookBased,
    }
  }
  if (meta === null || meta.enteredExisting) {
    return {
      worktreePath: undefined,
      worktreeBranch: undefined,
      worktreeHookBased: undefined,
    }
  }
  return {
    worktreePath: meta.worktreePath,
    worktreeBranch: meta.worktreeBranch,
    worktreeHookBased: meta.worktreeHookBased,
  }
}

/**
 * densable l7u — patch job worktreePath/Branch/HookBased when Tmo fires.
 */
export async function writeBgWorktreeMetaToJobState(
  meta: BgWorktreeMeta,
): Promise<void> {
  const id = resolveBgShort()
  if (!id) return
  try {
    const { readBgJobState, writeBgJobState } = await import(
      '../daemon/jobState.js'
    )
    const current = readBgJobState(id)
    if (!current) return
    const next = mergeWorktreeMetaForJob(meta, current)
    if (
      next.worktreePath === current.worktreePath &&
      next.worktreeBranch === current.worktreeBranch &&
      next.worktreeHookBased === current.worktreeHookBased
    ) {
      return
    }
    writeBgJobState(id, {
      ...current,
      ...next,
      updatedAt: new Date().toISOString(),
    })
  } catch {
    // never throw into UI path
  }
}

/**
 * densable u7u — when ihs fires, patch fan/budget/inFlight if fan key or
 * budget key changed. densable:
 *   o = items.length>0 ? items : void 0
 *   i = o===void 0 || Jat(o)===Jat(r.fan)   // empty items → keep current fan
 *   s = Xat(budget)===Xat(r.budget)
 *   if (i&&s) return  // no write (inFlight not refreshed if both same)
 * Skips terminal/blocked (densable gg / tempo blocked).
 */
export async function writeBgFanBudgetToJobState(): Promise<void> {
  const id = resolveBgShort()
  if (!id) return
  try {
    const { readBgJobState, writeBgJobState, isTerminalState } = await import(
      '../daemon/jobState.js'
    )
    const current = readBgJobState(id)
    if (!current) return
    if (isTerminalState(current) || current.state === 'crashed') return
    if (current.tempo === 'blocked') return
    const reg = getBgInFlightRegistry()
    const items = reg.items ?? []
    // densable: empty items → nextFan void 0 → fanSame always true (keep fan)
    const nextFan = items.length > 0 ? items : undefined
    const fanSame =
      nextFan === undefined ||
      fanItemsKey(nextFan) ===
        fanItemsKey(current.fan as Array<Record<string, unknown>> | undefined)
    const nextBudget = reg.budget as
      | { spent: number; target: number }
      | undefined
    const budgetSame =
      budgetProgressKey(nextBudget) ===
      budgetProgressKey(
        current.budget as { spent?: number; target?: number } | undefined,
      )
    if (fanSame && budgetSame) return
    // densable elt: fan:i?r.fan:o — when nextFan void 0 and !fanSame never happens;
    // when budget changes alone, fan stays current.fan; budget may clear to void 0.
    writeBgJobState(id, {
      ...current,
      fan: fanSame ? current.fan : nextFan,
      budget: budgetSame ? current.budget : nextBudget,
      inFlight: snapshotInFlight(),
      updatedAt: new Date().toISOString(),
    })
  } catch {
    // never throw
  }
}

function resolveBgShort(): string {
  const jobDir = process.env.CLAUDE_JOB_DIR
  if (!jobDir && !process.env.CLAUDE_BG_SHORT) return ''
  if (process.env.CLAUDE_BG_SHORT) return process.env.CLAUDE_BG_SHORT
  return (
    jobDir
      ?.replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || ''
  )
}

/**
 * densable c7u — subscribe once in bg workers:
 *   Vce → a7u, Tmo → l7u, ihs → u7u  (all on bridgeWriteChain, await e.inFlight).
 * Also seeds CLAUDE_BG_SHORT from job dir basename when missing (densable jZe).
 */
export function ensureBgNeedsPermissionBridge(): void {
  if (bridgeState.permissionBridgeSubscribed) return
  if (!process.env.CLAUDE_JOB_DIR) return
  if (!process.env.CLAUDE_BG_SHORT) {
    const id = process.env.CLAUDE_JOB_DIR.replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop()
    if (id) process.env.CLAUDE_BG_SHORT = id
  }
  bridgeState.permissionBridgeSubscribed = true
  // densable: bridgeWriteChain.then(() => e.inFlight ?? void 0).catch().then(write)
  const awaitInFlightThen = (fn: () => Promise<void>): void => {
    bridgeState.bridgeWriteChain = bridgeState.bridgeWriteChain
      .then(async () => {
        if (bridgeState.inFlight) {
          try {
            await bridgeState.inFlight
          } catch {
            // densable .catch(()=>{})
          }
        }
      })
      .catch(() => {})
      .then(() => fn())
      .catch(() => {})
  }
  subscribeBgNeedsInput(payload => {
    awaitInFlightThen(() => writeBgNeedsToJobState(payload))
  })
  // densable Tmo → l7u
  subscribeBgWorktreeMeta(meta => {
    awaitInFlightThen(() => writeBgWorktreeMetaToJobState(meta))
  })
  // densable ihs → u7u
  subscribeBgInFlight(() => {
    awaitInFlightThen(() => writeBgFanBudgetToJobState())
  })
  // Emit current snapshot if any producer fired before subscribe.
  const snap = getBgNeedsInputSnapshot()
  if (snap) {
    awaitInFlightThen(() => writeBgNeedsToJobState(snap))
  }
  if (lastTmo) {
    awaitInFlightThen(() => writeBgWorktreeMetaToJobState(lastTmo))
  }
}

/** densable-compatible: await current bridge write chain (tests / callers). */
export function awaitBgNeedsBridgeIdle(): Promise<void> {
  return bridgeState.bridgeWriteChain.catch(() => {})
}

/** Test helper / advanced: set e.inFlight promise densable awaits before writes. */
export function setBgNeedsBridgeInFlight(
  p: Promise<void> | null | undefined,
): void {
  bridgeState.inFlight = p ?? null
}

/** Test helper. */
export function _resetBgNeedsInputBridgeForTests(): void {
  for (const k of SOURCE_PRIORITY) slots[k] = null
  lastEmitted = null
  bridgeState.permissionBridgeSubscribed = false
  bridgeState.bridgeWriteChain = Promise.resolve()
  bridgeState.inFlight = null
  lastTmo = null
  tmoListeners.clear()
  resetBgInFlightRegistry()
}
