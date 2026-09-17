/**
 * densable 2.1.232 #4 — interactive session name uniqueness
 * (`ZM_` / `JM_` / `YM_` / `XM_` / `Lid` / `kp` / `EFe` / `mEn` / `Bid` /
 * `G$o` / `Nid` / `QM_` / `jid`).
 *
 * When another live session on this machine already holds the desired name,
 * yield a `name-word-word` (optional `-N`) variant and notify the user.
 */

import { feature } from 'bun:bundle'
import { getSessionId, isTeleportedSessionId } from '../bootstrap/state.js'
import { getReplBridgeHandle } from '../bridge/replBridgeHandle.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getRegisteredSessionName,
  listLiveSessionRecords,
  type RegisteredSessionName,
  type SessionNameSource,
  updateSessionName,
} from './concurrentSessions.js'
import { logForDebugging } from './debug.js'
import {
  patchBgJobDirRespawnFlags,
  resolveBgJobShortId,
  patchBgJobRegistrySessionName,
} from './sessionNameJobSidecar.js'
import {
  getCurrentSessionAgentName,
  getCurrentSessionTitle,
  getActiveSessionTranscriptPath,
  saveAgentName,
  saveAiGeneratedTitle,
  saveCustomTitle,
  shouldSuppressSessionTitleHistory,
} from './sessionStorage.js'
import { getPinnedStorageV5 } from './storageV5/index.js'
import {
  SESSION_TITLE_MAX_CODE_POINTS,
  sanitizeSessionTitle,
} from './sessionTitleSanitize.js'
import { generateShortWordSlug, isKnownShortWordSlug } from './words.js'

/** densable `qM_` — random suffix attempts before numeric tail. */
export const SESSION_NAME_SUFFIX_ATTEMPTS = 16

/** densable `KM_` — max UDS correspondents tracked for rename notice. */
export const SESSION_NAME_CORRESPONDENT_CAP = 64

/** densable `eO_` — recheck delay (ms); exported for callers. */
export const SESSION_NAME_RECHECK_MS = 3000

/**
 * densable `kp` — compare key for session names.
 * NFKC → strip Cc/Cf (whitespace runs kept then collapsed) → trim → lower → spaces→`-`.
 */
export function normalizeSessionNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ch => (/\s/.test(ch) ? ch : ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/**
 * densable `hi` (UTF-16-safe prefix) used when building `base-suffix` under aqt=200.
 * Session titles are capped by code points elsewhere; here densable uses
 * string length with high-surrogate trim.
 */
export function truncateSessionNamePrefix(input: string, max: number): string {
  if (max <= 0) return ''
  if (input.length <= max) return input
  let r = input.slice(0, max)
  const last = r.charCodeAt(max - 1)
  // high surrogate alone at end — drop it
  if (last >= 0xd800 && last <= 0xdbff) {
    r = r.slice(0, -1)
  }
  return r
}

export type LiveSessionNameRecord = {
  pid: number
  name?: string
  startedAt: number
  /** densable `procStart` — unix / non-FFI win32 process-start identity. */
  procStart?: string
  /** densable `procStartFt` — win32 kernel32 FFI FILETIME identity. */
  procStartFt?: string
  /** densable `nameSince` — when this name was claimed. */
  nameSince?: number
  /** densable nameSource — Bid skips `derived`. */
  nameSource?: SessionNameSource
  /** densable `sock` / messagingSocketPath — for jid peer notice. */
  sock?: string
}

/**
 * densable process-start stamp for YM_/Lid.
 * Any non-empty `procStart` **or** `procStartFt` counts — densable YM_ only
 * requires "has process-start identity", not the AFe/kUe lock-pick exclusivity
 * (win32 FFI rejects legacy `procStart` when matching live process locks).
 */
export function sessionRecordProcessStartIdentity(
  rec: LiveSessionNameRecord,
): string | undefined {
  if (typeof rec.procStartFt === 'string' && rec.procStartFt.length > 0) {
    return rec.procStartFt
  }
  if (typeof rec.procStart === 'string' && rec.procStart.length > 0) {
    return rec.procStart
  }
  return undefined
}

/**
 * densable `Lid` — whether `a` is strictly older / lower-priority than `b`
 * (started earlier wins the name; then process-start identity; then pid).
 */
export function isOlderSessionRecord(
  a: LiveSessionNameRecord,
  b: LiveSessionNameRecord,
): boolean {
  if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt
  const ra = sessionRecordProcessStartIdentity(a) ?? ''
  const rb = sessionRecordProcessStartIdentity(b) ?? ''
  if (ra !== rb) return ra < rb
  return a.pid < b.pid
}

/**
 * densable `YM_` — live holders of normalized name excluding self.
 * Requires process-start identity (procStart / procStartFt) so a recycled PID
 * without a stamped start token cannot hold a name.
 */
export function findNameHolders(
  nameKey: string,
  live: readonly LiveSessionNameRecord[],
  selfPid: number,
): LiveSessionNameRecord[] {
  return live.filter(
    n =>
      n.pid !== selfPid &&
      n.name !== undefined &&
      sessionRecordProcessStartIdentity(n) !== undefined &&
      normalizeSessionNameKey(n.name) === nameKey,
  )
}

/**
 * Lenient holders: match by name even without process-start identity.
 * densable product path uses strict {@link findNameHolders}; keep for tests
 * and intentional migration fallbacks.
 */
export function findNameHoldersLenient(
  nameKey: string,
  live: readonly LiveSessionNameRecord[],
  selfPid: number,
): LiveSessionNameRecord[] {
  return live.filter(
    n =>
      n.pid !== selfPid &&
      n.name !== undefined &&
      normalizeSessionNameKey(n.name) === nameKey,
  )
}

/** densable `XM_` — set of normalized names in use. */
export function collectOccupiedNameKeys(
  live: readonly LiveSessionNameRecord[],
): Set<string> {
  const out = new Set<string>()
  for (const t of live) {
    if (t.name === undefined) continue
    const k = normalizeSessionNameKey(t.name)
    if (k) out.add(k)
  }
  return out
}

/**
 * densable `JM_` — allocate `base-word-word` (then `base-word-word-N`) not in occupied.
 * `slug` defaults to densable `EFe` = `generateShortWordSlug` (adjective-noun).
 */
export function allocateUniqueSessionName(
  base: string,
  occupied: ReadonlySet<string>,
  slug: () => string = generateShortWordSlug,
  maxCodePoints: number = SESSION_TITLE_MAX_CODE_POINTS,
): string {
  const build = (suffix: string): string => {
    const prefix = truncateSessionNamePrefix(
      base,
      maxCodePoints - suffix.length - 1,
    )
    return `${prefix}-${suffix}`
  }
  for (let i = 0; i < SESSION_NAME_SUFFIX_ATTEMPTS; i++) {
    const candidate = build(slug())
    if (!occupied.has(normalizeSessionNameKey(candidate))) return candidate
  }
  for (let n = 2; ; n++) {
    const candidate = build(`${slug()}-${n}`)
    if (!occupied.has(normalizeSessionNameKey(candidate))) return candidate
  }
}

export type SessionNameMoment = 'rename' | 'startup' | 'recheck'

export type SessionNameUniquenessDecision =
  | { kind: 'keep' }
  | {
      kind: 'yield'
      newName: string
      holders: LiveSessionNameRecord[]
    }

/**
 * densable `ZM_` — decide whether `desiredName` must yield to older live holders.
 */
export function decideSessionNameUniqueness(input: {
  desiredName: string
  self: LiveSessionNameRecord
  live: readonly LiveSessionNameRecord[]
  moment: SessionNameMoment
  suffixBase?: string
  slug?: () => string
  /**
   * densable product path is **strict** (requires process-start identity).
   * Pass `true` only for migration/tests without stamped registry rows.
   */
  lenientHolders?: boolean
}): SessionNameUniquenessDecision {
  const suffixBase = input.suffixBase ?? input.desiredName
  const key = normalizeSessionNameKey(input.desiredName)
  if (!key) return { kind: 'keep' }

  // densable YM_ default: strict (procStart/procStartFt required).
  const find =
    input.lenientHolders === true ? findNameHoldersLenient : findNameHolders
  const holders = find(key, input.live, input.self.pid)

  let contested: LiveSessionNameRecord[]
  if (input.moment === 'rename') {
    contested = holders
  } else if (input.moment === 'startup') {
    contested = holders.filter(u => isOlderSessionRecord(u, input.self))
  } else {
    // recheck: compare nameSince when present
    contested = holders.filter(u =>
      isOlderSessionRecord(
        {
          ...u,
          startedAt: u.nameSince ?? u.startedAt,
        },
        {
          ...input.self,
          startedAt: input.self.nameSince ?? input.self.startedAt,
        },
      ),
    )
  }

  if (contested.length === 0) return { kind: 'keep' }

  return {
    kind: 'yield',
    newName: allocateUniqueSessionName(
      suffixBase,
      collectOccupiedNameKeys(input.live),
      input.slug,
    ),
    holders: contested,
  }
}

/** densable user-facing yield notice (rename / startup). */
export function formatSessionNameYieldMessage(
  desiredName: string,
  newName: string,
): string {
  return `Another live session on this machine goes by "${desiredName}", so this session is now "${newName}". Use /rename to pick a different name.`
}

/** densable rename success with collision parenthetical. */
export function formatSessionRenamedMessage(
  finalName: string,
  yieldedFrom?: string,
): string {
  if (!yieldedFrom) return `Session renamed to: ${finalName}`
  return `Session renamed to: ${finalName} ("${yieldedFrom}" is held by another live session on this machine)`
}

/**
 * densable system prompt fragment when a requested name was yielded.
 */
export function formatSessionNameYieldSystemContext(
  requested: string,
  actual: string,
): string {
  return `The user asked to name this session "${requested}"; another live session on this machine already holds that name, so this session is "${actual}". The requested name may indicate the session's focus or intent.`
}

/**
 * Sanitize then run uniqueness (pure, given live records).
 * Returns the name to persist and whether it was yielded.
 */
export function resolveUniqueSessionName(input: {
  desiredName: string
  self: LiveSessionNameRecord
  live: readonly LiveSessionNameRecord[]
  moment: SessionNameMoment
  suffixBase?: string
}): { name: string; yielded: boolean; holders: LiveSessionNameRecord[] } {
  const sanitized = sanitizeSessionTitle(input.desiredName)
  if (!sanitized) {
    return { name: input.desiredName, yielded: false, holders: [] }
  }
  const decision = decideSessionNameUniqueness({
    desiredName: sanitized,
    self: input.self,
    live: input.live,
    moment: input.moment,
    suffixBase: input.suffixBase
      ? sanitizeSessionTitle(input.suffixBase) || sanitized
      : sanitized,
  })
  if (decision.kind === 'keep') {
    return { name: sanitized, yielded: false, holders: [] }
  }
  // densable re-sanitizes the allocated name (V0)
  const finalName = sanitizeSessionTitle(decision.newName) || decision.newName
  return { name: finalName, yielded: true, holders: decision.holders }
}

/** densable `Kzs` — GrowthBook gate default true. */
export function isSessionNameUniquenessEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_session_name_uniqueness',
    true,
  )
}

export type SessionNameUniquenessDeps = {
  whenRegistered: () => Promise<boolean>
  listLive: () => Promise<LiveSessionNameRecord[]>
}

const defaultDeps: SessionNameUniquenessDeps = {
  // Local registerSession is fire-and-forget before Bid; treat as ready.
  whenRegistered: async () => true,
  listLive: async () => {
    const rows = await listLiveSessionRecords()
    return rows.map(r => ({
      pid: r.pid,
      name: r.name,
      startedAt: r.startedAt,
      nameSince: r.nameSince,
      procStart: r.procStart,
      procStartFt: r.procStartFt,
      nameSource: r.nameSource,
      sock: r.messagingSocketPath,
    }))
  },
}

/**
 * densable `Nid` / `zD` — session-name process state (correspondents, lastYield).
 */
export class SessionNameState {
  /** address → pid (UDS only). densable Map order = insertion; cap KM_=64. */
  correspondents = new Map<string, number>()
  senderMode: (() => 'bypass' | 'prompting' | undefined) | null = null
  userTypedName: string | undefined
  hasAdopter = false
  lastYield: { base: string; name: string } | undefined
  pendingYield: [newName: string, previous: string] | undefined

  /** densable `noteCorrespondent` — only uds: addresses; LRU-ish via re-insert. */
  noteCorrespondent(address: string | undefined | null, pid: number): void {
    if (!address) return
    let target: string | undefined
    if (address.startsWith('uds:')) {
      target = address.slice(4)
    } else if (address.startsWith('/')) {
      target = address
    } else {
      return
    }
    if (!target) return
    const key = address.startsWith('uds:') ? address : `uds:${target}`
    this.correspondents.delete(key)
    this.correspondents.set(key, pid)
    if (this.correspondents.size > SESSION_NAME_CORRESPONDENT_CAP) {
      const first = this.correspondents.keys().next().value
      if (first !== undefined) this.correspondents.delete(first)
    }
  }

  /** densable `announceYield` — stash pending + fire jid async. */
  announceYield(newName: string, previous: string): void {
    this.pendingYield = [newName, previous]
    // densable emits yielded(new, previous); local jid is the consumer.
    // desired ≈ userTypedName (original request) or previous on first yield.
    const desired = this.userTypedName ?? previous
    void notifySessionNameCorrespondents(previous, newName, desired)
  }

  takePendingYield(): [string, string] | undefined {
    const p = this.pendingYield
    this.pendingYield = undefined
    return p
  }

  reset(): void {
    this.correspondents.clear()
    this.lastYield = undefined
    this.pendingYield = undefined
    this.senderMode = null
    this.userTypedName = undefined
    this.hasAdopter = false
  }
}

/** densable `zD` singleton. */
export const sessionNameState = new SessionNameState()

/** densable `$id` — note UDS peer that messaged us (or we messaged). */
export function noteSessionNameCorrespondent(
  address: string | undefined | null,
  pid: number,
): void {
  sessionNameState.noteCorrespondent(address, pid)
}

/**
 * densable `Fid` — parse trailing `-adj-noun` or `-adj-noun-N` collision suffix.
 */
export function parseCollisionNameSuffix(
  name: string,
): { base: string; suffix: string } | undefined {
  const t = /^(.*)-([a-z]+-[a-z]+)(-\d{1,4})?$/i.exec(name)
  if (!t) return undefined
  const pair = t[2]!.toLowerCase()
  if (!isKnownShortWordSlug(pair)) return undefined
  const base = t[1]!
  if (base.length === 0) return undefined
  const num = t[3] ?? ''
  return { base, suffix: `${pair}${num}` }
}

/** densable `Yzs` — base before collision suffix, or undefined. */
export function collisionNameBase(name: string): string | undefined {
  return parseCollisionNameSuffix(name)?.base
}

/**
 * densable `XAt` — if lastYield still matches desired base + current name, reuse.
 */
export function reuseLastYieldName(
  desired: string,
  currentName: string | undefined,
): string | undefined {
  if (!isSessionNameUniquenessEnabled()) return undefined
  const last = sessionNameState.lastYield
  const base = normalizeSessionNameKey(collisionNameBase(desired) ?? desired)
  if (
    last !== undefined &&
    currentName !== undefined &&
    normalizeSessionNameKey(last.name) ===
      normalizeSessionNameKey(currentName) &&
    last.base === base
  ) {
    return currentName
  }
  return undefined
}

/**
 * densable `QM_` — prefer lastYield reuse, else keep current collision name if
 * its base matches the desired base (truncated to fit suffix).
 */
export function preferStableYieldName(
  desired: string,
  self: LiveSessionNameRecord,
): string | undefined {
  const reuse = reuseLastYieldName(desired, self.name)
  if (reuse !== undefined) return reuse
  const n = self.name
  const parsed = n === undefined ? undefined : parseCollisionNameSuffix(n)
  if (n === undefined || parsed === undefined) return undefined
  const desiredBase = collisionNameBase(desired) ?? desired
  const prefix = truncateSessionNamePrefix(
    desiredBase,
    SESSION_TITLE_MAX_CODE_POINTS - parsed.suffix.length - 1,
  )
  return parsed.base.toLowerCase() === prefix.toLowerCase() ? n : undefined
}

/** densable jid user-facing body. */
export function formatSessionRenamePeerNotice(
  oldName: string,
  newName: string,
  desiredName: string,
): string {
  return `This session was renamed from "${oldName}" to "${newName}" ("${desiredName}" is held by another live session on this machine). Address this one as "${newName}" from now on.`
}

export type NotifySessionNameCorrespondentsDeps = {
  send?: (sock: string, body: string, fromName?: string) => Promise<void>
  listLive?: () => Promise<LiveSessionNameRecord[]>
  ownSocket?: () => string | undefined
  /** Test-only: skip densable `ig()` / UDS_INBOX product gate. */
  skipUdsGate?: boolean
}

/**
 * densable `jid` — tell UDS correspondents our name changed due to collision.
 * Gates: Kzs + ig(UDS_INBOX) + non-empty correspondents.
 */
export async function notifySessionNameCorrespondents(
  oldName: string,
  newName: string,
  desiredName: string,
  deps: NotifySessionNameCorrespondentsDeps = {},
): Promise<void> {
  if (!isSessionNameUniquenessEnabled()) return
  // bun:bundle: feature() only in if / ternary condition position
  if (!deps.skipUdsGate && !(feature('UDS_INBOX') ? true : false)) return
  if (sessionNameState.correspondents.size === 0) return

  const sanitize = (s: string) => sanitizeSessionTitle(s) || s
  const s = sanitize(oldName)
  const a = sanitize(newName)
  const l = sanitize(desiredName)
  const body = formatSessionRenamePeerNotice(s, a, l)

  const listLive = deps.listLive ?? defaultDeps.listLive
  let pidToSock: Map<number, string>
  try {
    pidToSock = new Map(
      (await listLive())
        .filter(r => typeof r.sock === 'string' && r.sock.length > 0)
        .map(r => [r.pid, r.sock!]),
    )
  } catch (e) {
    logForDebugging(
      `[session-name] rename notice skipped: registry unreadable (${e instanceof Error ? e.message : String(e)})`,
    )
    return
  }

  let ownSock =
    deps.ownSocket?.() ??
    (() => {
      try {
        return process.env.CLAUDE_CODE_MESSAGING_SOCKET
      } catch {
        return undefined
      }
    })()

  const send =
    deps.send ??
    (async (sock: string, text: string, fromName?: string) => {
      const { sendToUdsSocket } = await import('./udsClient.js')
      // densable uEn(m, body, fromName, …, trackReceipts:false)
      await sendToUdsSocket(sock, text, {
        timeoutMs: 3000,
        ...(fromName !== undefined ? { fromName } : {}),
      })
    })

  await Promise.all(
    [...sessionNameState.correspondents].map(async ([addr, pid]) => {
      let scheme: string
      let target: string
      try {
        const { parseAddress } = await import('./peerAddress.js')
        const p = parseAddress(addr)
        scheme = p.scheme
        target = p.target
      } catch {
        return
      }
      if (scheme !== 'uds' || !target || target === ownSock) return
      // densable: u.get(pid) === sock. Local note may store pid=0 when
      // peer-cred is unavailable — then accept if any live row still owns sock.
      const mapped = pidToSock.get(pid)
      if (pid === 0) {
        if (![...pidToSock.values()].includes(target)) return
      } else if (mapped !== target) {
        return
      }
      try {
        await send(target, body, a)
      } catch (e) {
        logForDebugging(
          `[session-name] rename notice to ${addr} failed: ${e instanceof Error ? e.message : 'send error'}`,
        )
      }
    }),
  )
}

/** densable `W$o` — still current registry name for this process. */
export async function isCurrentSessionName(
  name: string,
  listLive: SessionNameUniquenessDeps['listLive'] = defaultDeps.listLive,
): Promise<boolean> {
  const live = await listLive()
  const self = live.find(r => r.pid === process.pid)
  if (!self?.name) return false
  return normalizeSessionNameKey(self.name) === normalizeSessionNameKey(name)
}

/**
 * densable `mEn` — listLive + ZM_ + log on yield.
 * Returns the name to keep (possibly yielded variant).
 */
export async function resolveSessionNameWithLiveRegistry(
  desiredName: string,
  moment: SessionNameMoment,
  deps: SessionNameUniquenessDeps = defaultDeps,
  suffixBase: string = desiredName,
): Promise<{ name: string; yielded: boolean }> {
  if (!isSessionNameUniquenessEnabled()) {
    return { name: desiredName, yielded: false }
  }
  // densable: suffixBase = Yzs(suffixBase) ?? suffixBase (collision base)
  const effectiveSuffixBase = collisionNameBase(suffixBase) ?? suffixBase
  if (!(await deps.whenRegistered())) {
    return { name: desiredName, yielded: false }
  }
  try {
    const live = await deps.listLive()
    const self = live.find(r => r.pid === process.pid)
    if (!self) return { name: desiredName, yielded: false }
    const resolved = resolveUniqueSessionName({
      desiredName,
      self,
      live,
      moment,
      suffixBase: effectiveSuffixBase,
    })
    if (!resolved.yielded) {
      return { name: resolved.name, yielded: false }
    }
    // densable QM_: prefer lastYield / stable collision name when still valid
    const stable = preferStableYieldName(desiredName, self)
    const chosenRaw =
      stable !== undefined &&
      normalizeSessionNameKey(stable) !== normalizeSessionNameKey(desiredName)
        ? stable
        : resolved.name
    const chosen = sanitizeSessionTitle(chosenRaw) || chosenRaw
    logForDebugging(
      `[session-name] "${desiredName}" is held by live pid ${resolved.holders[0]?.pid}; this session takes "${chosen}"`,
      { level: 'info' },
    )
    sessionNameState.lastYield = {
      base: normalizeSessionNameKey(effectiveSuffixBase),
      name: chosen,
    }
    return { name: chosen, yielded: true }
  } catch (e) {
    logForDebugging(
      `[session-name] uniqueness check failed, keeping "${desiredName}": ${e instanceof Error ? e.message : String(e)}`,
      { level: 'warn' },
    )
    return { name: desiredName, yielded: false }
  }
}

/**
 * densable leftover `p8n(e, t)` — strict `===` on registry + title + agent.
 * `t===true` forces false (u8o `o` skip). Official: `d_()?.name===e&&my(We())===e&&l1e()===e`.
 */
export function isSessionNameFullyApplied(
  name: string,
  skipCheck = false,
): boolean {
  if (skipCheck) return false
  return (
    getRegisteredSessionName()?.name === name &&
    getCurrentSessionTitle(getSessionId()) === name &&
    getCurrentSessionAgentName() === name
  )
}

/**
 * densable leftover `rTe(e, t, n)` — live registry won during settle.
 * `e` = u8n snapshot `d_()`; `t` requested; `n` bY name.
 */
export function findSupersedingRegistryName(
  snapshot: RegisteredSessionName | undefined,
  requested: string,
  resolved: string,
): RegisteredSessionName | undefined {
  const live = getRegisteredSessionName()
  if (live === undefined || live.source === 'derived') return undefined
  if (
    live.source === 'collision' &&
    reuseLastYieldName(snapshot?.name ?? requested, live.name) !== undefined
  ) {
    return undefined
  }
  const key = normalizeSessionNameKey(live.name)
  if (
    (snapshot !== undefined &&
      key === normalizeSessionNameKey(snapshot.name)) ||
    key === normalizeSessionNameKey(requested) ||
    key === normalizeSessionNameKey(resolved)
  ) {
    return undefined
  }
  return live
}

export type SessionNameApplySource = 'user' | 'auto' | 'collision'

export type SessionNameSettleResult = {
  requested: string
  name: string
  recordSource: SessionNameSource
  settle:
    | 'pre-decided'
    | 'own-name'
    | 'held'
    | 'superseded'
    | 'kept'
    | 'yielded'
}

/** densable leftover `c8n`. */
export function mapApplySourceToAgentSource(
  source: SessionNameApplySource,
): 'user' | 'auto' | 'hook' {
  return source === 'collision' ? 'hook' : source
}

/** densable leftover `d8n`. */
export function getRegisteredOrAgentSessionName(): string | undefined {
  return getRegisteredSessionName()?.name ?? getCurrentSessionAgentName()
}

/** densable leftover `o8n`. */
export function mapSettleResultToOutcome(
  result: SessionNameSettleResult,
): 'superseded' | 'yielded' | 'kept' {
  switch (result.settle) {
    case 'superseded':
      return 'superseded'
    case 'yielded':
    case 'held':
      return 'yielded'
    default:
      return 'kept'
  }
}

export type ApplySessionNameOptions = {
  persistAgentName?: (
    name: string,
    source: 'user' | 'auto' | 'hook',
  ) => Promise<void>
  writeName?: (name: string, source: SessionNameSource) => Promise<void>
  deps?: SessionNameUniquenessDeps
  scheduleRecheck?: (fn: () => void) => void
  storageV5?: unknown
  credentials?: unknown
}

/** densable leftover `u8n(e,t,n)`. */
export async function settleSessionNameApply(
  requested: string,
  source: SessionNameApplySource,
  skipRte = false,
  deps: SessionNameUniquenessDeps = defaultDeps,
): Promise<SessionNameSettleResult> {
  await deps.whenRegistered()
  const registered = getRegisteredSessionName()
  if (source === 'collision') {
    return {
      requested,
      name: requested,
      recordSource: 'collision',
      settle: 'pre-decided',
    }
  }
  if (source === 'auto') {
    return {
      requested,
      name: requested,
      recordSource: 'auto',
      settle: 'own-name',
    }
  }
  if (
    registered !== undefined &&
    normalizeSessionNameKey(registered.name) ===
      normalizeSessionNameKey(requested) &&
    registered.source !== 'auto' &&
    registered.source !== 'derived'
  ) {
    return {
      requested,
      name: requested,
      recordSource:
        registered.source === 'collision' && !skipRte ? 'collision' : source,
      settle: 'own-name',
    }
  }
  const settled = await resolveSessionNameWithLiveRegistry(
    requested,
    'rename',
    deps,
  )
  const superseded = skipRte
    ? undefined
    : findSupersedingRegistryName(registered, requested, settled.name)
  if (superseded !== undefined) {
    return {
      requested,
      name: superseded.name,
      recordSource: superseded.source,
      settle: 'superseded',
    }
  }
  if (!settled.yielded) {
    return {
      requested,
      name: requested,
      recordSource: source,
      settle: 'kept',
    }
  }
  const name = sanitizeSessionTitle(settled.name) || requested
  return {
    requested,
    name,
    recordSource: 'collision',
    settle: settled.name === registered?.name ? 'held' : 'yielded',
  }
}

async function mirrorSessionNameToJobSidecar(
  name: string,
  recordSource: SessionNameSource,
  storageV5: unknown,
  previousNames: Array<string | undefined>,
): Promise<void> {
  const f = recordSource === 'collision' ? 'collision' : 'user'
  const prev = previousNames.filter((n): n is string => n !== undefined)
  await patchBgJobDirRespawnFlags(
    '--name',
    ['-n'],
    name,
    { name, nameSource: f },
    storageV5,
    prev,
  )
  await patchBgJobRegistrySessionName(
    resolveBgJobShortId(),
    name,
    f,
    storageV5,
    prev,
  )
}

/**
 * densable leftover `s8n(e,t,n,r,o=!1,s,i)`.
 */
export async function persistSettledSessionName(
  rawName: string,
  source: SessionNameApplySource = 'user',
  storageV5: unknown = getPinnedStorageV5(),
  precomputed?: SessionNameSettleResult,
  setUserTyped = false,
  previousNames?: Array<string | undefined>,
  credentials?: unknown,
  opts: ApplySessionNameOptions = {},
): Promise<string | null> {
  const a = sanitizeSessionTitle(rawName)
  if (!a) return null
  const writeName =
    opts.writeName ??
    ((name: string, recordSource: SessionNameSource) =>
      updateSessionName(name, recordSource, storageV5))
  const deps = opts.deps ?? defaultDeps
  const persistAgentName = opts.persistAgentName
  const l = previousNames ?? [getRegisteredOrAgentSessionName(), a]
  const c =
    precomputed?.name === a
      ? precomputed
      : await settleSessionNameApply(a, source, setUserTyped, deps)
  const u = c.name
  if (c.settle === 'superseded') return u
  if (
    precomputed === undefined &&
    source !== 'auto' &&
    isSessionNameFullyApplied(u, false)
  ) {
    return u
  }
  // Official `if(await ZAt(d,u,p,c8n(t),n),o)yp().userTypedName=u`.
  // ZAt always; p=`zS()??Du()`. persistAgentName is leftover test hook.
  if (persistAgentName) {
    await persistAgentName(u, mapApplySourceToAgentSource(source))
  } else {
    const sid = getSessionId()
    if (sid) {
      await saveAgentName(
        sid as import('crypto').UUID,
        u,
        getActiveSessionTranscriptPath(),
        mapApplySourceToAgentSource(source),
      )
    }
  }
  if (setUserTyped) sessionNameState.userTypedName = u
  await writeName(u, c.recordSource)
  if (c.settle === 'kept' || c.settle === 'yielded') {
    scheduleSessionNameRenameRecheck({
      name: u,
      suffixBase: c.settle === 'yielded' ? c.requested : undefined,
      onYield: async f => {
        if (sessionNameState.hasAdopter) {
          await writeName(f, 'collision')
        } else {
          await applySessionName(
            f,
            'collision',
            storageV5,
            false,
            false,
            credentials,
            {
              ...opts,
              writeName,
              deps,
            },
          )
        }
      },
      deps,
      scheduleRecheck: opts.scheduleRecheck,
    })
  }
  if (source !== 'auto') {
    await mirrorSessionNameToJobSidecar(u, c.recordSource, storageV5, l)
  }
  return u
}

/**
 * densable leftover `fj` = `pt` = `At().remote`.
 * Default caps.remote is null. Official `Kx`/`En` have no product JS caller.
 */
export type SurfaceRemoteKind = 'ccr' | 'ssh' | 'direct'

export type SurfaceRemoteHandle = {
  kind: SurfaceRemoteKind
  isRemoteMode: true
  viewerOnly?: boolean
  sessionId?: string
}

export type SurfaceCapabilities = {
  renderTarget: 'ink'
  workspace: 'local' | 'remote'
  canDrive: boolean
  transcriptSource: 'local-jsonl'
  remote: SurfaceRemoteHandle | null
}

function createDefaultSurfaceCapabilities(): SurfaceCapabilities {
  return {
    renderTarget: 'ink',
    workspace: 'local',
    canDrive: true,
    transcriptSource: 'local-jsonl',
    remote: null,
  }
}

let currentSurfaceCapabilities = createDefaultSurfaceCapabilities()

/** densable leftover `At` / `Nx` — `surfaceCapabilities.caps()`. */
export function getSurfaceCapabilities(): SurfaceCapabilities {
  return currentSurfaceCapabilities
}

/** densable leftover `fj` / `pt`. */
export function getSurfaceRemoteHandle(): SurfaceRemoteHandle | null {
  return getSurfaceCapabilities().remote
}

/** densable leftover `Kx` — `replaceCaps`. Official JS has no caller. */
export function replaceSurfaceCapabilities(next: SurfaceCapabilities): void {
  currentSurfaceCapabilities = next
}

export function resetSurfaceCapabilitiesForTests(): void {
  currentSurfaceCapabilities = createDefaultSurfaceCapabilities()
}

/**
 * densable leftover `i8n` / `ke(e,o)`.
 * Official `S` = `lQc` / `f` @206645384: strip `session_`/`cse_` prefix.
 * `u()??a()` → getReplBridgeHandle. `V(o)` = non-empty string.
 */
export function stripBridgeSessionIdPrefix(id: string): string {
  return id.replace(/^(?:session|cse)_/, '')
}

export function syncReplBridgeSelfTitle(
  bridgeSessionId: string,
  name: string,
): void {
  const handle = getReplBridgeHandle()
  if (
    handle &&
    stripBridgeSessionIdPrefix(handle.bridgeSessionId) ===
      stripBridgeSessionIdPrefix(bridgeSessionId)
  ) {
    handle.selfTitle =
      typeof name === 'string' && name !== '' ? name : undefined
  }
}

/** densable leftover `mhe` — returns `u8o` name. */
export async function applySessionName(
  rawName: string,
  source: SessionNameApplySource,
  storageV5: unknown = getPinnedStorageV5(),
  skipRte = false,
  userInitiated = false,
  credentials?: unknown,
  opts: ApplySessionNameOptions = {},
): Promise<string | null> {
  const result = await applySessionNameWithOutcome(
    rawName,
    source,
    storageV5,
    skipRte,
    userInitiated,
    credentials,
    opts,
  )
  return result === null ? null : result.name
}

/** densable leftover `u8o`. */
export async function applySessionNameWithOutcome(
  rawName: string,
  source: SessionNameApplySource,
  storageV5: unknown = getPinnedStorageV5(),
  skipRte = false,
  userInitiated = false,
  credentials?: unknown,
  opts: ApplySessionNameOptions = {},
): Promise<{
  name: string
  outcome: 'superseded' | 'unchanged' | 'yielded' | 'kept'
} | null> {
  const i = sanitizeSessionTitle(rawName)
  if (!i) return null
  const previous = [getRegisteredOrAgentSessionName(), i]
  const settle = await settleSessionNameApply(
    i,
    source,
    skipRte,
    opts.deps ?? defaultDeps,
  )
  const name = settle.name
  if (settle.settle === 'superseded') {
    return { name, outcome: 'superseded' }
  }
  if (source !== 'auto' && isSessionNameFullyApplied(name, userInitiated)) {
    if (settle.settle === 'held') {
      await mirrorSessionNameToJobSidecar(
        name,
        'collision',
        storageV5,
        previous,
      )
    }
    return { name, outcome: 'unchanged' }
  }
  const sid = getSessionId()
  // Official: auto → XAt(u,c,n); else YAt(u,c,zS()??Du(),c8n(t),n).
  if (source === 'auto') {
    saveAiGeneratedTitle(sid as import('crypto').UUID, name)
  } else {
    await saveCustomTitle(
      sid as import('crypto').UUID,
      name,
      getActiveSessionTranscriptPath(),
      mapApplySourceToAgentSource(source),
      storageV5,
    )
  }
  if (shouldSuppressSessionTitleHistory(sid)) {
    await persistSettledSessionName(
      name,
      source,
      storageV5,
      settle,
      skipRte,
      previous,
      credentials,
      opts,
    )
    return { name, outcome: mapSettleResultToOutcome(settle) }
  }
  const handle = getReplBridgeHandle()
  const bridgeSessionId = handle?.bridgeSessionId
  if (handle && bridgeSessionId && handle.titleWriter) {
    syncReplBridgeSelfTitle(bridgeSessionId, name)
    const { getBridgeAccessToken, getBridgeBaseUrl } = await import(
      '../bridge/bridgeConfig.js'
    )
    const token = getBridgeAccessToken()
    void handle.titleWriter
      .update(bridgeSessionId, name, {
        baseUrl: getBridgeBaseUrl(),
        getAccessToken: token ? () => token : undefined,
        shouldSend: () => {
          if (
            shouldSuppressSessionTitleHistory(sid) ||
            getReplBridgeHandle()?.bridgeSessionId !== bridgeSessionId
          ) {
            return false
          }
          return !isTeleportedSessionId(bridgeSessionId)
        },
        userInitiated,
        credentials,
      })
      .catch(() => {})
  }
  await persistSettledSessionName(
    name,
    source,
    storageV5,
    settle,
    skipRte,
    previous,
    credentials,
    opts,
  )
  // Official u8o: `m=fj(); m?.kind==="ccr"&&m.sessionId`. fj=`At().remote`.
  // leftover 239 CCR latch is not fj. Do not invent Kx/En callers.
  const m = getSurfaceRemoteHandle()
  if (m?.kind === 'ccr' && m.sessionId) {
    const g = m.sessionId
    void import('./teleport/api.js').then(({ updateSessionTitle }) =>
      updateSessionTitle(g, name),
    )
  }
  return { name, outcome: mapSettleResultToOutcome(settle) }
}

/**
 * densable leftover s8n(e, "user", storageV5) — Pi / Kr 3-arg.
 */
export async function applyLeftoverS8nUserName(
  rawName: string,
  opts: ApplySessionNameOptions = {},
): Promise<string | null> {
  return persistSettledSessionName(
    rawName,
    'user',
    opts.storageV5 ?? getPinnedStorageV5(),
    undefined,
    false,
    undefined,
    opts.credentials,
    opts,
  )
}

/** densable `Uid` — schedule recheck after eO_=3000ms. */
export function scheduleSessionNameRecheck(fn: () => void): void {
  const t = setTimeout(fn, SESSION_NAME_RECHECK_MS)
  t.unref?.()
}

export type RunSessionNameStartupUniquenessInput = {
  /** densable Bid `sessionNameArg` — CLI `--name` / env seed. */
  sessionNameArg?: string
  interactive: boolean
  /** densable writeName(name, source). */
  writeName?: (name: string, source: SessionNameSource) => Promise<void>
  onRenamed?: (newName: string, previous: string) => void
  deps?: SessionNameUniquenessDeps
  scheduleRecheck?: (fn: () => void) => void
  /**
   * densable `yne()` — current registered name. If omitted, read from listLive self.
   * Skip when source is `derived` (auto titles).
   */
  getCurrentName?: () => Promise<
    { name: string; source?: SessionNameSource } | undefined
  >
}

/**
 * densable `Bid` — startup uniqueness for interactive sessions that already
 * have a non-derived name (or just received sessionNameArg).
 */
export async function runSessionNameStartupUniqueness(
  input: RunSessionNameStartupUniquenessInput,
): Promise<void> {
  const deps = input.deps ?? defaultDeps
  const schedule = input.scheduleRecheck ?? scheduleSessionNameRecheck
  const writeName =
    input.writeName ??
    ((name: string, source: SessionNameSource) =>
      updateSessionName(name, source))

  if (input.sessionNameArg) {
    await writeName(input.sessionNameArg, 'user')
    sessionNameState.userTypedName = input.sessionNameArg
  }

  const current =
    (await input.getCurrentName?.()) ??
    (await (async () => {
      const live = await deps.listLive()
      const self = live.find(r => r.pid === process.pid)
      if (!self?.name) return undefined
      return { name: self.name, source: self.nameSource }
    })())

  if (!input.interactive || !current || current.source === 'derived') {
    return
  }

  const run = async (
    name: string,
    isRecheck: boolean,
    suffixBase: string = name,
  ): Promise<void> => {
    if (isRecheck && !(await isCurrentSessionName(name, deps.listLive))) {
      return
    }
    const result = await resolveSessionNameWithLiveRegistry(
      name,
      isRecheck ? 'recheck' : 'startup',
      deps,
      suffixBase,
    )
    if (!(await isCurrentSessionName(name, deps.listLive))) {
      return
    }
    if (!result.yielded) {
      if (!isRecheck) {
        schedule(() => {
          void run(name, true)
        })
      }
      return
    }
    await writeName(result.name, 'collision')
    if (sessionNameState.userTypedName === name) {
      sessionNameState.userTypedName = result.name
    }
    input.onRenamed?.(result.name, name)
    sessionNameState.announceYield(result.name, name)
    if (!isRecheck) {
      schedule(() => {
        void run(result.name, true, name)
      })
    }
  }

  await run(current.name, false)
}

/**
 * densable `G$o` — schedule a single recheck after rename.
 */
export function scheduleSessionNameRenameRecheck(input: {
  name: string
  suffixBase?: string
  onYield: (newName: string, previous: string) => Promise<void> | void
  deps?: SessionNameUniquenessDeps
  scheduleRecheck?: (fn: () => void) => void
}): void {
  const deps = input.deps ?? defaultDeps
  const schedule = input.scheduleRecheck ?? scheduleSessionNameRecheck
  const suffixBase = input.suffixBase ?? input.name
  schedule(() => {
    void (async () => {
      if (!(await isCurrentSessionName(input.name, deps.listLive))) return
      const result = await resolveSessionNameWithLiveRegistry(
        input.name,
        'recheck',
        deps,
        suffixBase,
      )
      if (
        !result.yielded ||
        !(await isCurrentSessionName(input.name, deps.listLive))
      ) {
        return
      }
      if (sessionNameState.userTypedName === input.name) {
        sessionNameState.userTypedName = result.name
      }
      await input.onYield(result.name, input.name)
      sessionNameState.announceYield(result.name, input.name)
    })()
  })
}
