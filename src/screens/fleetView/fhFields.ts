/**
 * densable 2.1.248 Fh leftover-missing fields — helpers for leftover
 * AgentView.refresh (gc.load / #O / #P) and SessionRow (rp / Ss).
 *
 * Official snapshot is `class gc` `#t=Fh()`. Do not invent `function Fh`,
 * `class gc`, `function rp`, or `function Xw`. Jobs / terminalHolders /
 * prStatuses stay on the existing leftover hosts.
 *
 * GOLD: gold-248-16-gc-full.txt · gold-248-16-fh-fields2.txt ·
 *       gold-248-16-fh-host.txt · gold-248-ie-remote.txt ·
 *       gold-248-ie-remote2.txt · gold-248-ie-remote3.txt
 *
 * `loadRemote` / `setRemoteWanted` / `#I` / `stopRemote` / `archiveRemote`
 * land on leftover AgentView.
 * Official `Hu()` returns `[]` — do not invent a second cloud list.
 * Official gg `Zs=!1` — do not invent remote tabs.
 */

import { open, stat } from 'fs/promises'
import { join } from 'path'
import type { SessionEntry } from '../../cli/bg/engine.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getProjectDir } from '../../utils/sessionStoragePortable.js'
import { isHarborKiteEnabled } from '../../utils/teleport/cloudPeerAccess.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { pruneMapToKeys } from './prStatuses.js'
import { isFleetBhSettled, isFleetExecJob } from './helpers.js'

export const FLEET_NOT_DELETED_LABEL = 'not deleted'
export const FLEET_LOOP_KICK_TIMES = '\u00d7'

/** Official `_2t` @180535795 — `peerProtocol??0 >= 1`. */
export const FLEET_PEER_PROTOCOL_MIN = 1

/** Official #O / zu age window. */
export const FLEET_ADOPTED_PEER_MAX_AGE_MS = 86_400_000

/** Official ic `Qu(..., 16384)`. */
export const FLEET_LOG_TAIL_BYTES = 16_384

/** Official ec `vh` — recent scheduled_task_fire timestamps kept. */
const LOOP_SCAN_RECENT = 7
/** Official ec `Rh`. */
const LOOP_SCAN_CHUNK = 1_048_576
/** Official ec `ba`. */
const LOOP_SCAN_TAIL = 16
/** Official ec `_h`. */
const LOOP_FIRE_NEEDLE = '"subtype":"scheduled_task_fire"'
/** Official ec `Eh`. */
const LOOP_FIRE_TS = /"timestamp":"([^"]+)"/

export type FleetLoBand = 'active' | 'completed' | 'blocked'

export type FleetJobState = {
  state?: string
  tempo?: string
  intent?: string
  initialPrompt?: string
  routine?: string
  selfWake?: boolean
  inFlight?: { kinds?: readonly string[] }
  cwd?: string
  sessionId?: string
  resumeSessionId?: string
  template?: string
  respawnFlags?: readonly string[]
  backend?: string
  originCwd?: string
  createdAt?: string
  updatedAt?: string
  firstTerminalAt?: string | null
  detail?: string
  needs?: string
  name?: string
  output?: unknown
  children?: ReadonlyArray<{ kind?: string; href?: string }> | null
  linkScanOffset?: number
}

export type FleetLogTails = Record<string, string>

export type FleetLoopKick = {
  mtimeMs: number
  count: number
  nextAt: number | null
}

export type FleetLoopKicks = Map<string, FleetLoopKick>

export type FleetDeleteRefusals = Map<string, string>

export type FleetStatuses = Map<string, string>

export type FleetPendingJob = {
  id: string
  /** Official Ut `activity:"flowing"`. */
  activity?: string
  state: {
    sessionId?: string
    intent?: string
    cwd?: string
    originCwd?: string
    tempo?: string
    template?: string
  }
}

export type FleetRemoteJob = {
  id: string
  activity?: string
  state?: FleetJobState
}

/** Official `Hu` row — `listRemoteSessions:()=>Hu()` @192130133. */
export type FleetRemoteSessionRow = {
  id: string
  title?: string | null
  worker_status?: string
  created_at?: string
  last_event_at?: string
  config?: {
    sources?: ReadonlyArray<{ type?: string; url?: string }>
  }
  external_metadata?: {
    pending_action?: {
      tool_name?: string
      display_tool_name?: string
      action_description?: string
      input?: unknown
    }
  }
}

/** Official `Th` @192129961 — `w8(this.#i,this.loadRemote,Th)`. */
export const FLEET_REMOTE_POLL_MS = 30_000

/** Official `pc` @192129961 — `#S` / `#w` overlay TTL. */
export const FLEET_REMOTE_OVERLAY_MS = 120_000

export type FleetAdoptedPeer = {
  id: string
  state: ReturnType<typeof fleetPeerStateFromLive>
}

export type FleetLiveStatusRecord = {
  kind?: string
  pid: number
  sessionId?: string
  jobId?: string
  status?: string
  /** Official zu `i.state??i.status`. */
  state?: string
  parkedJobId?: string
  startedAt?: number
  updatedAt?: number
  peerProtocol?: number
  name?: string
  cwd?: string
  waitingFor?: string
  needs?: string
  detail?: string
  tempo?: string
  agent?: string
  entrypoint?: string
  sock?: string
}

export type FleetLoopScanCache = {
  scanStates: Map<
    string,
    {
      ino: number
      offset: number
      tail: Buffer
      count: number
      recent: number[]
    }
  >
  inFlightScans: Set<string>
}

/** Official `Xu` @192121946. */
export function createLoopScanCache(): FleetLoopScanCache {
  return { scanStates: new Map(), inFlightScans: new Set() }
}

const loopScanCache = createLoopScanCache()

/** Official `nc` @192123510. */
export function pruneLoopScanCache(
  cache: FleetLoopScanCache,
  livePaths: Set<string>,
): void {
  for (const path of cache.scanStates.keys()) {
    if (!livePaths.has(path)) cache.scanStates.delete(path)
  }
}

/** Official `$ye` @182998628. */
export function isFleetLoopKickState(state: {
  intent?: string
  initialPrompt?: string
}): boolean {
  const starts = (value?: string): boolean =>
    value?.trim().toLowerCase().startsWith('/loop') ?? false
  return starts(state.intent) || starts(state.initialPrompt)
}

/** Official `rP` @182998742. */
export function isFleetSelfDrivingState(state: FleetJobState): boolean {
  return (
    state.routine !== undefined ||
    state.selfWake === true ||
    (state.inFlight?.kinds?.includes('session_cron') ?? false) ||
    isFleetLoopKickState(state)
  )
}

/** Official `Cf` @182998017. */
export function fleetCfActivity(
  state: string | undefined,
): 'success' | 'failure' | 'stopped' | null {
  if (state === 'done') return 'success'
  if (state === 'failed') return 'failure'
  if (state === 'stopped') return 'stopped'
  return null
}

/**
 * Official `lo` @192125206 — `d` is liveStatus.
 * load() calls `lo(P.state)` (no live overlay).
 */
export function fleetLoBand(
  state: FleetJobState,
  liveStatus?: string,
): FleetLoBand {
  if (liveStatus === 'busy') return 'active'
  const settled = isFleetBhSettled({
    state: state.state,
    tempo: state.tempo,
  })
  if (
    settled &&
    !(
      fleetCfActivity(state.state) === 'success' &&
      isFleetSelfDrivingState(state)
    )
  ) {
    return 'completed'
  }
  if (state.tempo === 'blocked' || liveStatus === 'waiting') {
    return 'blocked'
  }
  return 'active'
}

export function isFleetLogTailEligible(state: FleetJobState): boolean {
  return fleetLoBand(state) !== 'completed'
}

/** Official `Ir` @192126376. */
export function fleetJobStatusKey(jobId: string): string {
  return `job:${jobId}`
}

/** Official `ac` @192126408. */
export function fleetStatusOf(
  statuses: ReadonlyMap<string, string>,
  job: { id: string; state: FleetJobState },
): string | undefined {
  return (
    statuses.get(job.state.resumeSessionId ?? job.state.sessionId ?? '') ??
    statuses.get(fleetJobStatusKey(job.id))
  )
}

/**
 * Official `liveStatus` @192132906 — Fh `statuses` + `pendings` + leftover
 * terminalHolders. `#b` kick / `#h` settle grace are gc privates, not Fh.
 */
export function fleetLiveStatus(
  job: { id: string; state: FleetJobState },
  ctx: {
    statuses: ReadonlyMap<string, string>
    holders: ReadonlyMap<string, number>
    pendings: ReadonlyArray<FleetPendingJob>
    heldInTerminal?: boolean
  },
): string | undefined {
  const sessionId = job.state.sessionId
  if (
    isFleetExecJob({
      template: job.state.template,
      respawnFlags: job.state.respawnFlags,
    })
  ) {
    return job.state.tempo === 'active' ? 'busy' : undefined
  }
  if (job.state.backend === 'remote') {
    if (job.state.tempo === 'active') return 'busy'
    if (job.state.tempo === 'blocked') return 'waiting'
    return undefined
  }
  if (
    sessionId !== undefined &&
    ctx.pendings.some(pending => pending.state.sessionId === sessionId)
  ) {
    return 'busy'
  }
  const held =
    ctx.heldInTerminal === true ||
    (job.state.backend !== 'peer' &&
      job.state.backend !== 'remote' &&
      ctx.holders.get(job.state.resumeSessionId ?? sessionId ?? '') !==
        undefined)
  const live = held
    ? ctx.statuses.get(fleetJobStatusKey(job.id))
    : fleetStatusOf(ctx.statuses, job)
  return live
}

/** Official #O statuses fill. */
export function buildFleetStatuses(
  live: readonly FleetLiveStatusRecord[],
): FleetStatuses {
  const statuses: FleetStatuses = new Map()
  for (const session of live) {
    if (!session.status) continue
    if (session.sessionId) statuses.set(session.sessionId, session.status)
    if (session.jobId) {
      statuses.set(fleetJobStatusKey(session.jobId), session.status)
    }
  }
  return statuses
}

export function nextFleetStatuses(
  prev: FleetStatuses,
  next: FleetStatuses,
): FleetStatuses {
  if (
    prev.size === next.size &&
    [...next].every(([key, value]) => prev.get(key) === value)
  ) {
    return prev
  }
  return next
}

/** Official #p logTails identity. */
export function nextLogTails(
  prev: FleetLogTails,
  entries: ReadonlyArray<readonly [string, string]>,
): FleetLogTails {
  const next = Object.fromEntries(entries)
  const keys = Object.keys(prev)
  if (
    keys.length === entries.length &&
    keys.every(key => prev[key] === next[key])
  ) {
    return prev
  }
  return next
}

/** Official `noteDeleteRefusal`. */
export function noteDeleteRefusal(
  prev: FleetDeleteRefusals,
  id: string,
  reason: string | null,
): FleetDeleteRefusals {
  if ((prev.get(id) ?? null) === reason) return prev
  const next = new Map(prev)
  if (reason === null) next.delete(id)
  else next.set(id, reason)
  return next
}

export function pruneDeleteRefusals(
  prev: FleetDeleteRefusals,
  liveIds: Set<string>,
): FleetDeleteRefusals {
  return pruneMapToKeys(prev, liveIds)
}

export function nextLoopKicks(
  prev: FleetLoopKicks,
  updates: ReadonlyArray<readonly [string, FleetLoopKick] | null | undefined>,
): FleetLoopKicks {
  let changed = false
  const next = new Map(prev)
  for (const row of updates) {
    if (!row) continue
    next.set(row[0], row[1])
    changed = true
  }
  return changed ? next : prev
}

export function pruneLoopKicks(
  prev: FleetLoopKicks,
  sessionIds: Set<string>,
): FleetLoopKicks {
  return pruneMapToKeys(prev, sessionIds)
}

/**
 * Official `Po() && R("tengu_fleetview_peers", !1)`.
 * Leftover Po is `isHarborKiteEnabled`. GB default OFF.
 */
export function isFleetPeersWanted(): boolean {
  return (
    isHarborKiteEnabled() &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_fleetview_peers', false)
  )
}

/** Official `zu` @192120270. */
export function fleetPeerStateFromLive(live: FleetLiveStatusRecord): {
  state: string
  detail: string
  tempo: string
  needs: string | undefined
  output: null
  children: null
  linkScanOffset: number
  template: string
  respawnFlags: []
  name: string | undefined
  intent: string
  sessionId: string
  cwd: string | undefined
  originCwd: string | undefined
  createdAt: string
  updatedAt: string
  firstTerminalAt: null
  backend: 'peer'
  sock: string | undefined
  pid: number
} {
  const started = live.startedAt ?? 0
  const updated = live.updatedAt ?? started
  return {
    state: live.state ?? live.status ?? 'running',
    detail: live.detail ?? live.waitingFor ?? '',
    tempo:
      live.tempo ??
      (live.status === 'busy'
        ? 'active'
        : live.status === 'waiting'
          ? 'blocked'
          : 'idle'),
    needs: live.needs,
    output: null,
    children: null,
    linkScanOffset: 0,
    template: live.agent ?? live.entrypoint ?? 'interactive',
    respawnFlags: [],
    name: live.name,
    intent: live.name ?? '',
    sessionId: live.sessionId ?? '',
    cwd: live.cwd,
    originCwd: live.cwd,
    createdAt: new Date(started).toISOString(),
    updatedAt: new Date(updated).toISOString(),
    firstTerminalAt: null,
    backend: 'peer',
    sock: live.sock,
    pid: live.pid,
  }
}

/**
 * Official #O adoptedPeers write. `(peerProtocol??0) >= _2t`.
 * Leftover registerSession now stamps peerProtocol; mapper reads it.
 */
export function buildAdoptedPeers(
  live: readonly FleetLiveStatusRecord[],
  jobSessionIds: ReadonlySet<string>,
  selfPid: number,
  now: number = Date.now(),
): FleetAdoptedPeer[] {
  return live
    .filter(
      session =>
        session.kind === 'interactive' &&
        session.pid !== selfPid &&
        !!session.sessionId &&
        !jobSessionIds.has(session.sessionId) &&
        (session.peerProtocol ?? 0) >= FLEET_PEER_PROTOCOL_MIN &&
        now - (session.updatedAt ?? session.startedAt ?? 0) <
          FLEET_ADOPTED_PEER_MAX_AGE_MS,
    )
    .map(session => ({
      id: `peer-${session.pid}`,
      state: fleetPeerStateFromLive(session),
    }))
}

/** Official #P overlay reset predicate. */
export function shouldResetFhOverlay(input: {
  pendings: readonly unknown[]
  remoteJobs: ReadonlyArray<{ id: string }>
  remoteListLoaded: boolean
  overlaidLoadLanded: boolean
}): boolean {
  const remote = input.remoteJobs.some(job =>
    job.id.startsWith('remote-pending-'),
  )
    ? input.remoteJobs.filter(job => !job.id.startsWith('remote-pending-'))
    : input.remoteJobs
  return (
    input.pendings.length > 0 ||
    remote !== input.remoteJobs ||
    input.remoteListLoaded ||
    input.overlaidLoadLanded
  )
}

export function resetFhOverlay<
  T extends {
    pendings: FleetPendingJob[]
    remoteJobs: FleetRemoteJob[]
    remoteListLoaded: boolean
    overlaidLoadLanded: boolean
  },
>(input: T): T {
  const remote = input.remoteJobs.some(job =>
    job.id.startsWith('remote-pending-'),
  )
    ? input.remoteJobs.filter(job => !job.id.startsWith('remote-pending-'))
    : input.remoteJobs
  return {
    ...input,
    pendings: input.pendings.length > 0 ? [] : input.pendings,
    remoteJobs: remote,
    remoteListLoaded: false,
    overlaidLoadLanded: false,
  }
}

/** Official `settleLandedPendings` id filter. */
export function settleLandedPendings(
  pendings: readonly FleetPendingJob[],
  landedIds: ReadonlySet<string>,
): FleetPendingJob[] {
  return pendings.filter(pending => !landedIds.has(pending.id))
}

/** Official updatePendings append — `w.updatePendings((Se)=>[...Se,Ut])`. */
export function mintFleetPending(input: {
  id: string
  intent?: string
  cwd?: string
  template?: string
}): FleetPendingJob {
  return {
    id: input.id,
    activity: 'flowing',
    state: {
      intent: input.intent,
      cwd: input.cwd,
      originCwd: input.cwd,
      tempo: 'active',
      template: input.template,
    },
  }
}

export function appendFleetPending(
  prev: readonly FleetPendingJob[],
  pending: FleetPendingJob,
): FleetPendingJob[] {
  return [...prev, pending]
}

export function patchFleetPending(
  prev: readonly FleetPendingJob[],
  id: string,
  next: FleetPendingJob,
): FleetPendingJob[] {
  return prev.map(pending => (pending.id === id ? next : pending))
}

export function removeFleetPending(
  prev: readonly FleetPendingJob[],
  id: string,
): FleetPendingJob[] {
  return prev.filter(pending => pending.id !== id)
}

function fleetCwdStartsWith(
  cwd: string | undefined,
  cwdFilter: string | undefined,
): boolean {
  if (!cwdFilter) return true
  const normalized = cwdFilter.replace(/\\/g, '/').toLowerCase()
  return (cwd ?? '').replace(/\\/g, '/').toLowerCase().startsWith(normalized)
}

/** Official pending row → leftover SessionEntry (rp treats pendings as jobs). */
export function sessionFromPending(pending: FleetPendingJob): SessionEntry {
  return {
    pid: 0,
    sessionId: pending.state.sessionId ?? '',
    short: pending.id,
    cwd: pending.state.cwd ?? pending.state.originCwd ?? '',
    startedAt: Date.now(),
    kind: 'bg',
    name: pending.state.intent || pending.id,
    status: 'busy',
    tempo: 'active',
    backend: 'daemon',
    lastMessage: pending.state.intent,
    template: pending.state.template,
    daemonState: 'working',
  }
}

/** Official zu peer job → leftover SessionEntry. */
export function sessionFromAdoptedPeer(peer: FleetAdoptedPeer): SessionEntry {
  const created = Date.parse(peer.state.createdAt)
  const updated = Date.parse(peer.state.updatedAt)
  const tempo = peer.state.tempo as SessionEntry['tempo']
  return {
    pid: peer.state.pid,
    sessionId: peer.state.sessionId,
    short: peer.id,
    cwd: peer.state.cwd ?? '',
    startedAt: Number.isFinite(created) ? created : Date.now(),
    updatedAt: Number.isFinite(updated) ? updated : undefined,
    kind: 'bg',
    name: peer.state.name ?? peer.state.intent,
    status:
      tempo === 'active' ? 'busy' : tempo === 'blocked' ? 'waiting' : 'idle',
    waitingFor: peer.state.needs,
    lastMessage: peer.state.detail || undefined,
    tempo,
    daemonState: peer.state.state,
    backend: 'peer',
    template: peer.state.template,
  }
}

/**
 * Official remote job → leftover SessionEntry. Missing state is skipped
 * (pending-only / empty `Hu()` rows). Official gg `Zs=!1` — no remote tabs.
 */
export function sessionFromRemoteJob(job: FleetRemoteJob): SessionEntry | null {
  if (!job.state) return null
  const created = Date.parse(job.state.createdAt ?? '')
  const updated = Date.parse(job.state.updatedAt ?? '')
  const tempo = job.state.tempo as SessionEntry['tempo']
  return {
    pid: 0,
    sessionId: job.state.sessionId ?? job.id,
    short: job.id,
    cwd: job.state.cwd ?? '',
    startedAt: Number.isFinite(created) ? created : Date.now(),
    updatedAt: Number.isFinite(updated) ? updated : undefined,
    kind: 'bg',
    name: job.state.name ?? job.state.intent ?? job.id,
    waitingFor: job.state.needs,
    lastMessage: job.state.detail || undefined,
    backend: 'remote',
    tempo,
    daemonState: job.state.state,
    template: job.state.template,
  }
}

/** Official `mr` @179877053 — `e.replace(/^(?:session|cse)_/,"")`. */
export function stripFleetRemoteSessionId(id: string): string {
  return id.replace(/^(?:session|cse)_/, '')
}

/** Official `WKe` @179877053 sha=6c0dd6b25bc80e00. */
export function fleetRemoteJobId(id: string): string {
  return `remote-${id.slice(-8)}`
}

/**
 * Official `Hu` @192115650 — `async function Hu(){return[]}`.
 * `Dh().listRemoteSessions:()=>Hu()`. Do not invent cloud listing.
 */
export async function listRemoteSessions(): Promise<FleetRemoteSessionRow[]> {
  return []
}

/** Official `hh` @192116575. */
export function fleetRemoteWorkerHh(status?: string): {
  state: string
  tempo: string
} {
  switch (status) {
    case 'requires_action':
      return { state: 'blocked', tempo: 'blocked' }
    case 'idle':
      return { state: 'done', tempo: 'idle' }
    default:
      return { state: 'working', tempo: 'active' }
  }
}

function askUserQuestionText(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const questions = (
    input as {
      questions?: Array<{ question?: string; text?: string }>
    }
  ).questions
  const first = questions?.[0]
  const text = first?.question ?? first?.text
  return typeof text === 'string' && text !== '' ? text : undefined
}

/** Official Gu `C` — leftover AskUserQuestion / ExitPlanMode hosts. */
function fleetRemoteNeeds(row: FleetRemoteSessionRow): string | undefined {
  if (row.worker_status !== 'requires_action') return undefined
  const action = row.external_metadata?.pending_action
  const tool = action?.tool_name
  if (tool === 'AskUserQuestion') {
    return askUserQuestionText(action?.input) ?? 'awaiting input'
  }
  if (
    tool === 'ExitPlanMode' ||
    tool === 'exit_plan_mode' ||
    tool === 'ExitPlanModeV2'
  ) {
    return 'approve plan'
  }
  if (
    typeof tool === 'string' &&
    typeof action?.action_description === 'string' &&
    action.action_description !== ''
  ) {
    const name =
      typeof action.display_tool_name === 'string' &&
      action.display_tool_name !== ''
        ? action.display_tool_name
        : tool
    const full = `approve ${name}: ${action.action_description}`
    return full.length > 120 ? `${full.slice(0, 117)}…` : full
  }
  return 'awaiting input'
}

/** Official `Gu` @192115692 sha=48de2b5e188bbd80. */
export function fleetRemoteStateFromSession(
  row: FleetRemoteSessionRow,
): FleetJobState {
  const { state, tempo } = fleetRemoteWorkerHh(row.worker_status)
  const gitUrl = row.config?.sources?.find(
    source => source.type === 'git_repository',
  )?.url
  const title = row.title ?? ''
  const cwd = gitUrl ?? 'remote'
  return {
    state,
    tempo,
    detail: title,
    needs: fleetRemoteNeeds(row),
    output: null,
    children: null,
    linkScanOffset: 0,
    template: 'remote',
    respawnFlags: [],
    name: title || undefined,
    intent: title || row.id,
    sessionId: row.id,
    cwd,
    originCwd: cwd,
    createdAt: row.created_at,
    updatedAt: row.last_event_at ?? row.created_at,
    firstTerminalAt: null,
    backend: 'remote',
  }
}

/** Official `gh` used by `Vu`. */
export function fleetRemoteJobsStateEqual(
  left: FleetJobState | undefined,
  right: FleetJobState | undefined,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => {
    const a = left[key as keyof FleetJobState]
    const b = right[key as keyof FleetJobState]
    if (a === b) return true
    return (
      typeof a === 'object' &&
      typeof b === 'object' &&
      a !== null &&
      b !== null &&
      Bun.deepEquals(a, b)
    )
  })
}

/** Official `Vu` @192116575 sha=f8e4d1413d50f705. */
export function mergeRemoteJobs(
  prev: readonly FleetRemoteJob[],
  fetched: readonly FleetRemoteJob[],
): FleetRemoteJob[] {
  const landed = new Set(
    fetched.map(job => stripFleetRemoteSessionId(job.state?.sessionId ?? '')),
  )
  const pending = prev.filter(
    job =>
      job.id.startsWith('remote-pending-') &&
      !landed.has(stripFleetRemoteSessionId(job.state?.sessionId ?? '')),
  )
  const next = [...fetched, ...pending]
  if (
    prev.length === next.length &&
    prev.every(
      (job, i) =>
        job.id === next[i]!.id &&
        job.activity === next[i]!.activity &&
        fleetRemoteJobsStateEqual(job.state, next[i]!.state),
    )
  ) {
    return prev as FleetRemoteJob[]
  }
  return next
}

/**
 * Official `Oo` @192124798 — `#I` calls `Oo(m.state)` (no PR map).
 * Leftover host is `fleetCfActivity` + `isFleetSelfDrivingState`.
 */
export function fleetOoActivity(state: FleetJobState): string {
  const settled = fleetCfActivity(state.state)
  if (
    settled &&
    state.tempo !== 'active' &&
    !(settled === 'success' && isFleetSelfDrivingState(state))
  ) {
    return settled
  }
  const updated = Date.parse(state.updatedAt ?? '')
  const elapsed = Date.now() - (Number.isFinite(updated) ? updated : 0)
  const mult = state.tempo === 'active' ? 1 : 5
  if (elapsed < mult * 3 * 60_000) return 'flowing'
  if (elapsed < mult * 15 * 60_000) return 'slowing'
  return 'stuck'
}

/** Official `#I` remoteJobs activity refresh. */
export function refreshRemoteJobsActivity(
  jobs: readonly FleetRemoteJob[],
): FleetRemoteJob[] {
  const next = jobs.map(job => {
    if (!job.state) return job
    const activity = fleetOoActivity(job.state)
    return activity === job.activity ? job : { ...job, activity }
  })
  return next.every((job, i) => job === jobs[i])
    ? (jobs as FleetRemoteJob[])
    : next
}

/** Official `loadRemote` mapper — WKe / Gu / #S stop overlay / #w archive. */
export function mapRemoteSessionsToJobs(
  rows: readonly FleetRemoteSessionRow[],
  opts: {
    stopUntil?: Map<string, number>
    archiveUntil?: Map<string, number>
    now?: number
  } = {},
): FleetRemoteJob[] {
  const now = opts.now ?? Date.now()
  const stopUntil = opts.stopUntil
  const archiveUntil = opts.archiveUntil
  return rows
    .map(row => {
      const id = fleetRemoteJobId(row.id)
      let state = fleetRemoteStateFromSession(row)
      const stopAt = stopUntil?.get(id)
      if (stopUntil && stopAt !== undefined) {
        if (isFleetBhSettled(state) || now > stopAt) {
          stopUntil.delete(id)
        } else {
          state = {
            ...state,
            state: 'stopped',
            tempo: 'idle',
            needs: undefined,
          }
        }
      }
      return { id, state, activity: fleetOoActivity(state) }
    })
    .filter(job => {
      const until = archiveUntil?.get(job.id)
      if (until === undefined) return true
      if (archiveUntil && now > until) {
        archiveUntil.delete(job.id)
        return true
      }
      return false
    })
}

/**
 * Official `loadRemote` @192140121.
 * `listRemoteSessions` defaults to leftover `Hu()` (`[]`).
 */
export async function loadRemoteJobs(input: {
  generation: number
  currentGeneration: () => number
  prev: readonly FleetRemoteJob[]
  attached: boolean
  listRemoteSessions?: () => Promise<readonly FleetRemoteSessionRow[]>
  stopUntil?: Map<string, number>
  archiveUntil?: Map<string, number>
  onError?: (err: unknown) => void
}): Promise<{ jobs?: FleetRemoteJob[]; loaded: boolean } | undefined> {
  try {
    const rows = await (input.listRemoteSessions ?? listRemoteSessions)()
    if (input.generation !== input.currentGeneration()) return undefined
    const fetched = mapRemoteSessionsToJobs(rows, {
      stopUntil: input.stopUntil,
      archiveUntil: input.archiveUntil,
    })
    return {
      jobs: mergeRemoteJobs(input.prev, fetched),
      loaded: input.attached,
    }
  } catch (err) {
    input.onError?.(err)
    if (input.generation === input.currentGeneration() && input.attached) {
      return { loaded: true }
    }
    return undefined
  }
}

/**
 * Official `stopRemote` @192140769 sha=e6ceb644d1007258
 * `async stopRemote(i){let d=i.state.sessionId;this.#S.set(i.id,Date.now()+pc),this.updateRemoteJobs(…!Di…);try{if(!await this.#e.interruptRemoteSession(d))throw Error("interrupt rejected");b("fleet_view_stop_session"),s("tengu_bg_agent_action",{action:v("stop"),source:v("fleet"),jobSessionId:ke(d)})}catch(m){throw f(…),n(…),this.#S.delete(i.id),this.loadRemote(),m}}`
 * Leftover residual: official duration `b`/`f` has no leftover wrapper.
 */
export async function stopRemote(input: {
  job: FleetRemoteJob
  stopUntil: Map<string, number>
  now?: number
  interruptRemoteSession?: (id: string) => Promise<boolean>
  updateRemoteJobs: (fn: (jobs: FleetRemoteJob[]) => FleetRemoteJob[]) => void
  loadRemote: () => void
  onError?: (err: unknown) => void
}): Promise<void> {
  const sessionId = input.job.state?.sessionId
  input.stopUntil.set(
    input.job.id,
    (input.now ?? Date.now()) + FLEET_REMOTE_OVERLAY_MS,
  )
  input.updateRemoteJobs(jobs =>
    jobs.map(job =>
      job.id === input.job.id && !isFleetBhSettled(job.state ?? {})
        ? {
            ...job,
            state: {
              ...job.state,
              state: 'stopped',
              tempo: 'idle',
              needs: undefined,
            },
            activity: 'stopped',
          }
        : job,
    ),
  )
  try {
    const interrupt =
      input.interruptRemoteSession ??
      (await import('../../utils/teleport.js')).interruptRemoteSession
    if (!sessionId || !(await interrupt(sessionId))) {
      throw new Error('interrupt rejected')
    }
    logEvent('tengu_bg_agent_action', {
      action:
        'stop' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source:
        'fleet' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      jobSessionId:
        sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } catch (err) {
    input.onError?.(err)
    input.stopUntil.delete(input.job.id)
    input.loadRemote()
    throw err
  }
}

/**
 * Official `archiveRemote` @192141350 sha=de30126b02b75c82
 * `async archiveRemote(i){let d=i.state.sessionId;this.#w.set(i.id,Date.now()+pc),this.updateRemoteJobs(filter);try{if(!await this.#e.archiveRemoteSession(d))throw Error("archive rejected");b("fleet_view_archive_session"),s("tengu_bg_agent_action",{action:v("archive"),…})}catch(m){throw f(…),n(…),this.#w.delete(i.id),this.loadRemote(),m}}`
 * Leftover residual: official duration `b`/`f` has no leftover wrapper.
 */
export async function archiveRemote(input: {
  job: FleetRemoteJob
  archiveUntil: Map<string, number>
  now?: number
  archiveRemoteSession?: (id: string) => Promise<boolean>
  updateRemoteJobs: (fn: (jobs: FleetRemoteJob[]) => FleetRemoteJob[]) => void
  loadRemote: () => void
  onError?: (err: unknown) => void
}): Promise<void> {
  const sessionId = input.job.state?.sessionId
  input.archiveUntil.set(
    input.job.id,
    (input.now ?? Date.now()) + FLEET_REMOTE_OVERLAY_MS,
  )
  input.updateRemoteJobs(jobs => jobs.filter(job => job.id !== input.job.id))
  try {
    const archive =
      input.archiveRemoteSession ??
      (await import('../../utils/teleport.js')).archiveRemoteSession
    if (!sessionId || !(await archive(sessionId))) {
      throw new Error('archive rejected')
    }
    logEvent('tengu_bg_agent_action', {
      action:
        'archive' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source:
        'fleet' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      jobSessionId:
        sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  } catch (err) {
    input.onError?.(err)
    input.archiveUntil.delete(input.job.id)
    input.loadRemote()
    throw err
  }
}

/**
 * Official `w8` @190519785 sha=d6f7a264a06acaed —
 * `function w8(r,i,l){… r.setTimeout(h,l) …}`.
 */
export function fleetRemotePoll(
  clock: { setTimeout: (fn: () => void, ms: number) => () => void },
  fn: () => void,
  ms: number,
): () => void {
  let stopped = false
  let cancel: (() => void) | undefined
  const tick = () => {
    if (stopped) return
    try {
      fn()
    } finally {
      if (!stopped) cancel = clock.setTimeout(tick, ms)
    }
  }
  cancel = clock.setTimeout(tick, ms)
  return () => {
    stopped = true
    cancel?.()
  }
}

/**
 * Official gg `Z=!Y||!!d?.startsWith("remote-")`.
 * `Y` = simpleView; `d` = initialJobId.
 */
export function fleetSimpleWantsRemote(input: {
  simpleView: boolean
  initialJobId?: string
}): boolean {
  return !input.simpleView || !!input.initialJobId?.startsWith('remote-')
}

/**
 * Official rp Ct / Mt / Lt @192178293.
 * `Ct=[...jobs,...peersEnabled?adoptedPeers:[]]`
 * `Mt=showRemoteTabs?remoteTab?remote:local:simpleWantsRemote?[...local,...remote]:local`
 * `Lt=pendings.filter(not already in Ht)`; `zt=Lt.length?hn([...Lt,...Ht]):Ht`
 * Official gg `Zs=!1` — leftover showRemoteTabs stays false unless caller sets it.
 */
export function fleetRpMerge(input: {
  sessions: readonly SessionEntry[]
  adoptedPeers: readonly FleetAdoptedPeer[]
  remoteJobs: readonly FleetRemoteJob[]
  pendings: readonly FleetPendingJob[]
  peersEnabled: boolean
  showRemoteTabs: boolean
  simpleWantsRemote: boolean
  activeTab?: string
  cwdFilter?: string
}): SessionEntry[] {
  const peers = input.peersEnabled
    ? input.adoptedPeers.map(sessionFromAdoptedPeer)
    : []
  let local = [...input.sessions, ...peers]
  if (input.cwdFilter) {
    local = local.filter(session =>
      fleetCwdStartsWith(session.cwd, input.cwdFilter),
    )
  }
  const remotes = input.remoteJobs
    .map(sessionFromRemoteJob)
    .filter((row): row is SessionEntry => row !== null)
  const scoped = input.showRemoteTabs
    ? input.activeTab === 'remote'
      ? remotes
      : local
    : input.simpleWantsRemote
      ? [...local, ...remotes]
      : local
  const extraPendings = input.pendings
    .filter(pending => !scoped.some(job => (job.short ?? '') === pending.id))
    .map(sessionFromPending)
  return extraPendings.length > 0 ? [...extraPendings, ...scoped] : [...scoped]
}

/**
 * @deprecated use fleetRpMerge — leftover 248 host for official rp Ct/Mt/Lt.
 */
export function fleetRpStayLocal(
  sessions: readonly SessionEntry[],
  overlay: {
    adoptedPeers: readonly FleetAdoptedPeer[]
    remoteJobs: readonly FleetRemoteJob[]
    pendings: readonly FleetPendingJob[]
    peersEnabled: boolean
    showRemoteTabs: boolean
    simpleWantsRemote: boolean
    activeTab?: string
    cwdFilter?: string
  },
): SessionEntry[] {
  return fleetRpMerge({ sessions, ...overlay })
}

/** Official `Mi` — `join(yu(cwd), sessionId.jsonl)`. */
export function fleetTranscriptPath(state: {
  cwd?: string
  sessionId?: string
}): string | undefined {
  if (!state.cwd || !state.sessionId) return undefined
  return join(getProjectDir(state.cwd), `${state.sessionId}.jsonl`)
}

/** Official `rc` used by Ih / Nt. */
export function stripFleetLogTailTags(text: string): string {
  return text.replace(
    /<(system-reminder|task-notification)>[\s\S]*?(<\/\1>|$)/g,
    ' ',
  )
}

/**
 * Official `Ih` @192123625 — last assistant text, or `> ` user, or
 * `✗ ` tool_result error.
 */
export function parseFleetLogTailLine(line: string): string | null {
  try {
    const row = jsonParse(line) as {
      type?: string
      message?: { content?: unknown }
    }
    if (row.type === 'assistant') {
      const content = row.message?.content
      const text = Array.isArray(content)
        ? (
            content.find(
              (block): block is { type: string; text?: string } =>
                !!block &&
                typeof block === 'object' &&
                (block as { type?: string }).type === 'text',
            ) as { text?: string } | undefined
          )?.text
        : undefined
      return text || null
    }
    if (row.type === 'user') {
      const content = row.message?.content
      const raw =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? (
                content.find(
                  (block): block is { type: string; text?: string } =>
                    !!block &&
                    typeof block === 'object' &&
                    (block as { type?: string }).type === 'text',
                ) as { text?: string } | undefined
              )?.text
            : undefined
      const first = raw
        ? stripFleetLogTailTags(raw)
            .split('\n')
            .find(part => part.trim())
            ?.trim()
        : undefined
      if (first) return `> ${first}`
      if (Array.isArray(content)) {
        const err = content.find(
          (
            block,
          ): block is { type: string; is_error?: boolean; content?: unknown } =>
            !!block &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'tool_result' &&
            (block as { is_error?: boolean }).is_error === true,
        )
        if (err) {
          const msg =
            typeof err.content === 'string'
              ? err.content
              : Array.isArray(err.content)
                ? (
                    err.content.find(
                      (block): block is { type: string; text?: string } =>
                        !!block &&
                        typeof block === 'object' &&
                        (block as { type?: string }).type === 'text',
                    ) as { text?: string } | undefined
                  )?.text
                : undefined
          if (msg) return `\u2717 ${msg}`
        }
      }
    }
  } catch {
    // official Ih catch → null
  }
  return null
}

async function readTailUtf8(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    const size = Math.min(maxBytes, info.size)
    const buf = Buffer.alloc(size)
    const start = Math.max(0, info.size - maxBytes)
    const { bytesRead } = await handle.read(buf, 0, size, start)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** Official `ic` @192124455 — last unique Ih line, or "". */
export async function readFleetLogTail(job: {
  state: FleetJobState
}): Promise<string> {
  try {
    const path = fleetTranscriptPath(job.state)
    if (!path) return ''
    const content = await readTailUtf8(path, FLEET_LOG_TAIL_BYTES)
    const parsed = content
      .split('\n')
      .map(parseFleetLogTailLine)
      .filter((line): line is string => line !== null)
    return (
      parsed.filter((line, i) => line !== parsed[i - 1]).at(-1) ?? ''
    ).trim()
  } catch {
    return ''
  }
}

/** Official `Fi` fs fallback — `{kind:"present",mtimeMs}`. */
export async function probeFleetTranscript(
  path: string,
): Promise<
  | { kind: 'present'; mtimeMs: number }
  | { kind: 'absent' }
  | { kind: 'unreadable'; code?: string }
> {
  try {
    const info = await stat(path)
    return { kind: 'present', mtimeMs: info.mtimeMs }
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code)
        : undefined
    if (code === 'ENOENT') return { kind: 'absent' }
    return { kind: 'unreadable', code }
  }
}

/**
 * Official `ec` @192122009 — incremental scheduled_task_fire scan.
 * Module cache is leftover `gc.#_ = Xu()`, not a second Fh store.
 */
export async function scanLoopTranscript(
  path: string,
  cache: FleetLoopScanCache = loopScanCache,
): Promise<{ count: number; nextAt: number | null } | null> {
  if (cache.inFlightScans.has(path)) return null
  cache.inFlightScans.add(path)
  try {
    const handle = await open(path, 'r')
    try {
      const info = await handle.stat()
      const size = info.size
      const ino = Number(info.ino)
      let cur = cache.scanStates.get(path)
      if (cur && (cur.ino !== ino || cur.offset > size)) cur = undefined
      if (cur && cur.tail.length > 0) {
        const check = Buffer.alloc(cur.tail.length)
        const { bytesRead } = await handle.read(
          check,
          0,
          check.length,
          cur.offset - check.length,
        )
        if (bytesRead !== check.length || !check.equals(cur.tail)) {
          cur = undefined
        }
      }
      if (!cur) {
        cur = {
          ino,
          offset: 0,
          tail: Buffer.alloc(0),
          count: 0,
          recent: [],
        }
        cache.scanStates.set(path, cur)
      }
      if (size > cur.offset) {
        let count = cur.count
        const recent = cur.recent.slice()
        const buf = Buffer.alloc(Math.min(LOOP_SCAN_CHUNK, size - cur.offset))
        let carry: Buffer | null = null
        let pos = cur.offset
        let consumed = cur.offset
        let tail = cur.tail
        while (pos < size) {
          const { bytesRead } = await handle.read(
            buf,
            0,
            Math.min(buf.length, size - pos),
            pos,
          )
          if (bytesRead <= 0) break
          const chunk = buf.subarray(0, bytesRead)
          const overlap = carry ? carry.length : 0
          const merged: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk
          let start = 0
          let nl = merged.indexOf(10, overlap)
          while (nl !== -1) {
            const line = merged.toString('utf-8', start, nl)
            if (line.includes(LOOP_FIRE_NEEDLE)) {
              const match = line.match(LOOP_FIRE_TS)
              const ts = match ? Date.parse(match[1]!) : Number.NaN
              if (Number.isFinite(ts)) {
                count++
                recent.push(ts)
                if (recent.length > LOOP_SCAN_RECENT) recent.shift()
              }
            }
            start = nl + 1
            nl = merged.indexOf(10, start)
          }
          consumed += start
          pos += bytesRead
          if (start >= LOOP_SCAN_TAIL) {
            tail = Buffer.from(merged.subarray(start - LOOP_SCAN_TAIL, start))
          } else if (start > 0) {
            const joined = Buffer.concat([tail, merged.subarray(0, start)])
            tail = joined.subarray(Math.max(0, joined.length - LOOP_SCAN_TAIL))
          }
          carry =
            start < merged.length ? Buffer.from(merged.subarray(start)) : null
        }
        if (consumed > cur.offset) {
          cur.offset = consumed
          cur.count = count
          cur.recent = recent
          cur.tail = tail
        }
      }
      const { count, recent } = cur
      if (recent.length < 2) return { count, nextAt: null }
      const gaps: number[] = []
      for (let i = 1; i < recent.length; i++) {
        gaps.push(recent[i]! - recent[i - 1]!)
      }
      gaps.sort((a, b) => a - b)
      const median = gaps[Math.floor(gaps.length / 2)]!
      const nextAt = recent.at(-1)! + median
      return { count, nextAt: nextAt > Date.now() ? nextAt : null }
    } finally {
      await handle.close()
    }
  } finally {
    cache.inFlightScans.delete(path)
  }
}

export async function refreshLoopKicks(
  jobs: ReadonlyArray<{ state: FleetJobState }>,
  prev: FleetLoopKicks,
  cache: FleetLoopScanCache = loopScanCache,
): Promise<FleetLoopKicks> {
  const loopJobs = jobs.filter(job => isFleetLoopKickState(job.state))
  const liveSessionIds = new Set(
    jobs.map(job => job.state.sessionId).filter((id): id is string => !!id),
  )
  const livePaths = new Set<string>()
  let next = prev
  if (loopJobs.length > 0) {
    const probed = (
      await Promise.all(
        loopJobs.map(async job => {
          const path = fleetTranscriptPath(job.state)
          if (!path || !job.state.sessionId) return null
          try {
            const probe = await probeFleetTranscript(path)
            if (probe.kind !== 'present') return null
            return [job.state.sessionId, probe.mtimeMs, path] as const
          } catch {
            return null
          }
        }),
      )
    )
      .filter((row): row is readonly [string, number, string] => row !== null)
      .filter(([sessionId, mtimeMs]) => {
        const known = prev.get(sessionId)
        return !known || known.mtimeMs !== mtimeMs
      })
    if (probed.length > 0) {
      const scanned = await Promise.all(
        probed.map(async ([sessionId, mtimeMs, path]) => {
          try {
            const scan = await scanLoopTranscript(path, cache)
            return scan ? ([sessionId, { mtimeMs, ...scan }] as const) : null
          } catch {
            return null
          }
        }),
      )
      next = nextLoopKicks(next, scanned)
    }
    for (const job of loopJobs) {
      const path = fleetTranscriptPath(job.state)
      if (path) livePaths.add(path)
    }
  }
  next = pruneLoopKicks(next, liveSessionIds)
  pruneLoopScanCache(cache, livePaths)
  return next
}

/** Official Ss delete-refused gate: Cf(state) && tempo !== "active". */
export function shouldShowDeleteRefusal(
  state: FleetJobState,
  reason: string | undefined,
): string | undefined {
  const activity = fleetCfActivity(state.state)
  if (activity && state.tempo !== 'active') return reason
  return undefined
}

/** Official Ss active-tempo logTail slot when job.detail is empty. */
export function fleetRowLogTailDetail(
  state: FleetJobState,
  detail: string | undefined,
  logTail: string | undefined,
): string {
  if (detail) return detail
  if (state.tempo === 'active' && fleetCfActivity(state.state) !== 'success') {
    return logTail ?? ''
  }
  return ''
}
