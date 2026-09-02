/**
 * densable UPw / zPw / VTm — comment scan + act (2.1.239).
 * Source: gold-UPw-239 / gold-zPw-239 / gold-yWt-239.
 *
 * zPw tip:
 *  - Surfaces new human comments via coalesce notify (full text).
 *  - Auto-replies via densable Ttn (nzt action:reply) when compose returns text.
 *  - X_r summon first-sight + desktop visible_handoff stand-down.
 *  - editCapable: optional attemptEdit hook (aDw/lDw invent-ban without host).
 */
import { createHash } from 'crypto'
import {
  CONSECUTIVE_AUTO_BREAKER,
  FAST_ACK_TEXT,
  PIPELINE_DENIAL_CAP,
  formatGateNotice,
  underHourlyAutoCap,
  verdictFromPermissionMode,
} from './actGates.js'
import { bumpUnattendedReply } from './reply.js'
import { coalesceNotice, formatArtifactDisplayName } from './coalesce.js'
import {
  commentLane,
  digestCommentThreads,
  readArtifactComments,
  type ArtifactComment,
  type ArtifactThread,
} from './commentRead.js'
import { Ttn } from './nzt.js'
import { mI, SN } from './gates.js'
import { un } from './store.js'
import {
  consumeVisibleHandoffClaims,
  isDesktopEntrypoint,
  isIsoZTimestamp,
  isSummonFresh,
  isVisibleHandoffGateOpen,
  outstandingSummons,
  waitForVisibleHandoffClaims,
} from './summon.js'

export type ThreadScanState = {
  seen: Set<string>
  ownReplyIds: Set<string>
  ownReplyIdsIncomplete?: boolean
  sentToClaudeAt: Map<string, string | null>
  lastAutoReplyAt: number | null
  consecutiveAuto: number
  breakerOpen: boolean
  consecutivePipelineDenials: number
  activatedAt: string | null
  activatedAtObserved: boolean
}

export type ArtifactScanState = {
  scanning: boolean
  baselined: boolean
  everBaselined: boolean
  everHadThreads: boolean
  lastReadDigest: string | null
  stampHighWater: string | null
  lastScanAt: number | null
  threads: Map<string, ThreadScanState>
  turnTimestamps: number[]
  pipelineDeniedNoticed?: boolean
  capNoticed?: boolean
  planModeNoticed?: boolean
  defaultModeNoticed?: boolean
  lastProbeAllowed?: boolean
  lastProbeDenied?: boolean
}

export type WakeArgs = {
  slug: string
  url: string
  title?: string
  env?: string
  seed?: boolean
  confirm?: boolean
  reentry?: boolean
  abort?: AbortController
  getTitle?: () => string | undefined
}

export type ScanDeps = {
  /** App permission mode (plan / default / auto / …). */
  getPermissionMode?: () => string
  /**
   * densable EP probe for action:reply empty text.
   * Default: verdictFromPermissionMode(getPermissionMode()).
   */
  checkReplyPermission?: (input: {
    slug: string
    url: string
    threadId: string
  }) => Promise<'allow' | 'deny' | 'ask'>
  /**
   * densable nzt / qPw / KPw compose — substantive reply text.
   * Null → skip auto-post (notify-only after gates).
   */
  composeAutoReply?: (input: {
    slug: string
    url: string
    thread: ArtifactThread
    newComments: ArtifactComment[]
    phase: 'fast_ack' | 'substantive'
    signal?: AbortSignal
  }) => Promise<string | null>
  /**
   * densable Ttn — defaults to nzt action:reply turn (HTTP post under the hood).
   */
  postReply?: (input: {
    slug: string
    threadId: string
    text: string
    signal?: AbortSignal
    answersSummon?: boolean
  }) => Promise<{ kind: 'ok' | 'error'; commentId?: string; message?: string }>
  /** densable PPw / tengu_gorse_sill — post fixed fast-ack before substantive. */
  fastAckEnabled?: () => boolean
  /**
   * densable aDw / lDw — editCapable path. When unset, reply-only (no invent HTML rewrite).
   */
  attemptEdit?: (input: {
    slug: string
    url: string
    thread: ArtifactThread
    summons: ArtifactComment[]
    signal: AbortSignal
  }) => Promise<'edited' | 'unavailable' | 'skipped' | 'timed_out'>
}

let scanDeps: ScanDeps = {}

export function setArtifactScanDeps(deps: ScanDeps): void {
  scanDeps = { ...scanDeps, ...deps }
}

export function resetArtifactScanDepsForTests(): void {
  scanDeps = {}
}

export function getArtifactScanDeps(): Readonly<ScanDeps> {
  return scanDeps
}

type WakeSlot = {
  coalesceTimer?: ReturnType<typeof setTimeout>
  lastWakeArgs: WakeArgs | null
  newestKickAt: number
  kickSettled: boolean
  lastScanScheduledAt: number
  inFlightScan: Promise<void> | null
  rescanWanted: boolean
  rescanArgs: WakeArgs | null
}

function wakeSlot(slug: string): WakeSlot {
  const map = un().wakes.wakes
  let slot = map.get(slug) as WakeSlot | undefined
  if (
    !slot ||
    typeof slot !== 'object' ||
    !('lastWakeArgs' in (slot as object))
  ) {
    slot = {
      lastWakeArgs: null,
      newestKickAt: 0,
      kickSettled: true,
      lastScanScheduledAt: 0,
      inFlightScan: null,
      rescanWanted: false,
      rescanArgs: null,
    }
    map.set(slug, slot)
  }
  return slot
}

/** densable cCl */
export function getArtifactScanState(slug: string): ArtifactScanState {
  const arts = un().autoReact.artifacts
  let s = arts.get(slug) as ArtifactScanState | undefined
  if (!s || typeof s !== 'object' || !('threads' in s)) {
    s = {
      scanning: false,
      baselined: false,
      everBaselined: false,
      everHadThreads: false,
      lastReadDigest: null,
      stampHighWater: null,
      lastScanAt: null,
      threads: new Map(),
      turnTimestamps: [],
    }
    arts.set(slug, s)
  }
  return s
}

/** densable tHe — scan generation stamp. */
function scanGeneration(): number {
  return un().wakes.scanGeneration
}

/** densable F3i / tkm portable coalesce delay. */
function wakeCoalesceMs(): number {
  const override = un().autoReact.coalesceMsOverride
  if (typeof override === 'number' && override >= 0)
    return Math.min(override, 5_000)
  return 250
}

function confirmDwellMs(): number {
  const o = un().autoReact.confirmDwellMsOverride
  if (typeof o === 'number' && o >= 0) return o
  return 0
}

/**
 * densable yWt → VTm schedule — coalesce then UPw.
 */
export function scheduleCommentScan(args: WakeArgs): void {
  if (!mI()) return
  if (SN(args.slug)) return
  const slot = wakeSlot(args.slug)
  const now = performance.now()
  const wall = Date.now()
  const isKick =
    args.seed !== true && args.confirm !== true && args.reentry !== true
  if (isKick) {
    slot.kickSettled = false
    slot.newestKickAt = now
  }
  slot.lastWakeArgs = args

  const fireLatest = (): void => {
    slot.coalesceTimer = undefined
    // Gold VTm closes over the armed wake; portable latest-wins so a
    // non-kick that only wrote lastWakeArgs is not dropped.
    void runUPw(slot.lastWakeArgs ?? args)
  }

  if (slot.coalesceTimer || getArtifactScanState(args.slug).scanning) {
    if (getArtifactScanState(args.slug).scanning) {
      slot.rescanWanted = true
      slot.rescanArgs = args
    }
    if (slot.coalesceTimer && isKick) {
      clearTimeout(slot.coalesceTimer)
      const delay = wakeCoalesceMs()
      slot.coalesceTimer = setTimeout(fireLatest, delay)
      slot.coalesceTimer.unref?.()
    }
    return
  }

  const minGap = wakeCoalesceMs()
  const recent =
    slot.lastScanScheduledAt !== 0 && wall - slot.lastScanScheduledAt < minGap
  const dwell = confirmDwellMs()
  const kickRemain = slot.kickSettled
    ? 0
    : Math.min(Math.max(0, slot.newestKickAt + dwell - now), dwell)
  const delay =
    args.confirm === true
      ? kickRemain
      : args.seed === true || recent
        ? minGap
        : args.reentry === true
          ? kickRemain
          : 0

  if (args.confirm !== true) slot.lastScanScheduledAt = wall + delay
  slot.coalesceTimer = setTimeout(fireLatest, delay)
  slot.coalesceTimer.unref?.()
}

async function runUPw(e: WakeArgs): Promise<void> {
  const slot = wakeSlot(e.slug)
  const p = UPw(e)
    .catch(() => {
      /* densable be scan_error */
    })
    .finally(() => {
      if (slot.inFlightScan === p) slot.inFlightScan = null
    })
  slot.inFlightScan = p
  await p
}

/**
 * densable UPw — read comments, digest, zPw each thread.
 */
export async function UPw(e: WakeArgs): Promise<void> {
  if (SN(e.slug)) return
  const { slug: t, url: r } = e
  const name = formatArtifactDisplayName(e.getTitle?.() ?? e.title, r)
  const a = getArtifactScanState(t)
  a.scanning = true
  const gen = scanGeneration()
  const actOnFirstSight = a.baselined && e.seed !== true
  if (e.seed === true) a.baselined = false
  const slot = wakeSlot(t)
  const kickAt = slot.newestKickAt
  const dwell = confirmDwellMs()
  const kickSettledNow = dwell === 0 || performance.now() - kickAt >= dwell

  try {
    const abort = e.abort ?? new AbortController()
    const read = await readArtifactComments(t, abort.signal, {
      env: e.env,
    })
    if (read.err !== null) {
      a.lastReadDigest = null
      return
    }
    if (scanGeneration() !== gen) return
    a.lastScanAt = Date.now()
    if (read.threadsDegraded === true) {
      a.everHadThreads = true
      a.lastReadDigest = null
      return
    }

    const ownMap = new Map<string, Set<string>>()
    for (const [id, st] of a.threads) ownMap.set(id, st.ownReplyIds)
    let digest: string | null = null
    if (read.threadsDropped !== true && scanGeneration() === gen) {
      digest = digestCommentThreads(read.threads, ownMap)
    }
    if (digest !== null) {
      a.lastReadDigest = digest
    } else {
      a.lastReadDigest = null
    }

    if (read.threads.length > 0 || read.threadsDropped === true) {
      a.everHadThreads = true
    }

    let deferredFirstSight = false
    for (const thread of read.threads) {
      if (scanGeneration() !== gen || SN(t)) return
      const out = await zPw({
        slug: t,
        url: r,
        artifactName: name,
        thread,
        artifactState: a,
        actOnFirstSight,
        seed: e.seed === true,
        threadsDropped: read.threadsDropped === true,
        abort,
      })
      if (out === 'deferred_first_sight') deferredFirstSight = true
    }

    if (
      !deferredFirstSight &&
      read.threadsDropped !== true &&
      !(
        read.threads.length === 0 &&
        (a.threads.size > 0 || a.everHadThreads)
      ) &&
      mI() &&
      !SN(t) &&
      scanGeneration() === gen
    ) {
      a.baselined = true
      a.everBaselined = true
    }
  } finally {
    a.scanning = false
    if (kickSettledNow && slot.newestKickAt === kickAt) slot.kickSettled = true
    if (slot.rescanWanted) {
      slot.rescanWanted = false
      const again = slot.rescanArgs ?? e
      slot.rescanArgs = null
      scheduleCommentScan({ ...again, reentry: true })
    } else if (
      !slot.kickSettled &&
      slot.newestKickAt !== 0 &&
      scanGeneration() === gen &&
      !SN(t)
    ) {
      scheduleCommentScan({
        ...e,
        seed: undefined,
        reentry: undefined,
        confirm: true,
      })
    }
  }
}

export type ZPwResult = undefined | 'deferred_first_sight'

/**
 * densable zPw portable — first-sight baseline / surface new humans / auto-reply.
 */
export async function zPw(input: {
  slug: string
  url: string
  artifactName: string
  thread: ArtifactThread
  artifactState: ArtifactScanState
  actOnFirstSight: boolean
  seed: boolean
  threadsDropped: boolean
  abort: AbortController
}): Promise<ZPwResult> {
  const {
    slug: t,
    url: r,
    artifactName: n,
    thread: o,
    artifactState: l,
  } = input
  if (!mI() || SN(t)) return

  if (o.commentsDegraded === true) {
    return l.threads.get(o.id) ? undefined : 'deferred_first_sight'
  }
  if (o.activatedAtDegraded === true && !l.threads.get(o.id)) {
    return 'deferred_first_sight'
  }

  let c = l.threads.get(o.id)
  if (!c) {
    // densable first sight: baseline all comments as seen except fresh X_r summons
    const now = Date.now()
    const freshSummonIds = new Set<string>()
    if (o.claudeActivated === true) {
      for (const s of outstandingSummons(o)) {
        if (isSummonFresh(s, now)) freshSummonIds.add(s.id)
      }
    }
    c = {
      seen: new Set(
        o.comments.filter(x => !freshSummonIds.has(x.id)).map(x => x.id),
      ),
      ownReplyIds: new Set(),
      sentToClaudeAt: new Map(
        o.comments
          .filter(x => !x.toClaudeAtDegraded)
          .map(x => [x.id, x.toClaudeAt ?? null] as const),
      ),
      lastAutoReplyAt: null,
      consecutiveAuto: 0,
      breakerOpen: false,
      consecutivePipelineDenials: 0,
      activatedAt: o.activatedAt ?? null,
      activatedAtObserved: true,
    }
    l.threads.set(o.id, c)
    l.everHadThreads = true
    // densable: first sight returns unless fresh X_r summons remain unseen
    if ((!input.actOnFirstSight || input.seed) && freshSummonIds.size === 0) {
      return
    }
  }

  if (o.activatedAtDegraded === true) return

  const newHuman: ArtifactComment[] = []
  for (const comment of o.comments) {
    if (c.seen.has(comment.id)) continue
    c.seen.add(comment.id)
    if (!c.sentToClaudeAt.has(comment.id)) {
      c.sentToClaudeAt.set(comment.id, comment.toClaudeAt ?? null)
    }
    if (commentLane(comment) === 'human') newHuman.push(comment)
    if (comment.postedByArtifact) c.ownReplyIds.add(comment.id)
  }

  if (newHuman.length === 0) return

  // densable visible_handoff — desktop entrypoint claims stand down CLI turn
  const summons = outstandingSummons(o).filter(s =>
    newHuman.some(h => h.id === s.id),
  )
  const summonAts = [...summons, ...newHuman]
    .map(cm => cm.toClaudeAt)
    .filter((at): at is string => isIsoZTimestamp(at))
  const uniqueAts = [...new Set(summonAts)]
  if (
    uniqueAts.length > 0 &&
    uniqueAts.length === summonAts.length &&
    isDesktopEntrypoint() &&
    isVisibleHandoffGateOpen()
  ) {
    let claimed = consumeVisibleHandoffClaims(t, o.id, uniqueAts)
    if (!claimed) {
      claimed =
        (await waitForVisibleHandoffClaims(
          t,
          o.id,
          uniqueAts,
          input.abort.signal,
        )) && consumeVisibleHandoffClaims(t, o.id, uniqueAts)
      if (!claimed && input.abort.signal.aborted) return
    }
    if (claimed) {
      // stood_down_visible_turn
      return
    }
  }

  const detail = [
    `New comment(s) on artifact ${r} (thread ${o.id}):`,
    ...newHuman.map(
      cm =>
        `- [${cm.id}] ${cm.account || 'someone'}: ${cm.text.slice(0, 2000)}`,
    ),
    `Re-read the thread and reply if appropriate (Artifact reply on thread ${o.id}).`,
  ].join('\n')

  coalesceNotice({
    slug: t,
    family: 'artifact-auto-react',
    artifactName: n,
    detail,
    mergeDetails: 'append',
    threadId: o.id,
  })

  // densable editCapable — optional aDw/lDw host; tip does not invent HTML rewrite
  if (
    o.editCapable === true &&
    o.claudeActivated === true &&
    !o.resolved &&
    scanDeps.attemptEdit
  ) {
    try {
      await scanDeps.attemptEdit({
        slug: t,
        url: r,
        thread: o,
        summons,
        signal: input.abort.signal,
      })
    } catch {
      /* continue to reply */
    }
  }

  await runAutoReplyPipeline({
    slug: t,
    url: r,
    artifactName: n,
    thread: o,
    newComments: newHuman,
    artifactState: l,
    threadState: c,
    abort: input.abort,
    answersSummon: summons.length > 0,
  })
}

/**
 * densable zPw auto-reply tail — probe / plan / hourly cap / nzt compose / Ttn post.
 */
export async function runAutoReplyPipeline(input: {
  slug: string
  url: string
  artifactName: string
  thread: ArtifactThread
  newComments: ArtifactComment[]
  artifactState: ArtifactScanState
  threadState: ThreadScanState
  abort: AbortController
  answersSummon?: boolean
}): Promise<void> {
  const {
    slug: t,
    url: r,
    artifactName: n,
    thread: o,
    newComments,
    artifactState: l,
    threadState: c,
    answersSummon,
  } = input

  if (c.breakerOpen) return

  if (c.consecutivePipelineDenials >= PIPELINE_DENIAL_CAP) {
    if (!l.pipelineDeniedNoticed) {
      l.pipelineDeniedNoticed = true
      const g = formatGateNotice('comment', 'pipeline', r, n)
      coalesceNotice({
        slug: t,
        family: 'artifact-auto-react',
        artifactName: n,
        detail: g.detail,
        mergeDetails: 'append',
        threadId: o.id,
      })
    }
    return
  }

  const now = Date.now()
  const cap = underHourlyAutoCap(l.turnTimestamps, now)
  l.turnTimestamps = cap.timestamps
  if (!cap.ok) {
    if (!l.capNoticed) {
      l.capNoticed = true
      const g = formatGateNotice('comment', 'cap', r, n)
      coalesceNotice({
        slug: t,
        family: 'artifact-auto-react',
        artifactName: n,
        detail: g.detail,
        mergeDetails: 'append',
        threadId: o.id,
      })
    }
    return
  }

  const mode = scanDeps.getPermissionMode?.() ?? 'default'
  if (mode === 'plan') {
    l.lastProbeAllowed = false
    if (!l.planModeNoticed) {
      l.planModeNoticed = true
      const g = formatGateNotice('comment', 'plan', r, n)
      coalesceNotice({
        slug: t,
        family: 'artifact-auto-react',
        artifactName: n,
        detail: g.detail,
        mergeDetails: 'append',
        threadId: o.id,
      })
    }
    return
  }

  let verdict: 'allow' | 'deny' | 'ask' = verdictFromPermissionMode(mode)
  if (scanDeps.checkReplyPermission) {
    try {
      verdict = await scanDeps.checkReplyPermission({
        slug: t,
        url: r,
        threadId: o.id,
      })
    } catch {
      c.consecutivePipelineDenials++
      return
    }
  } else if (
    process.env.CLAUDE_CODE_ARTIFACT_AUTOREACT_AUTOREPLY === '1' ||
    process.env.CLAUDE_CODE_ARTIFACT_AUTOREACT_AUTOREPLY === 'true'
  ) {
    // Explicit env opt-in only. composeAutoReply is the writer, not a probe —
    // product bootstrap always installs it; treating it as allow fail-opens
    // default mode (gold FPw / notify-only).
    verdict = 'allow'
  }

  l.lastProbeAllowed = verdict === 'allow'
  l.lastProbeDenied = verdict === 'deny'

  if (verdict === 'deny') return

  if (verdict !== 'allow') {
    // densable ask_mode → notify_only (once)
    if (!l.defaultModeNoticed) {
      l.defaultModeNoticed = true
      const g = formatGateNotice('comment', 'notify_only', r, n)
      coalesceNotice({
        slug: t,
        family: 'artifact-auto-react',
        artifactName: n,
        detail: g.detail,
        mergeDetails: 'append',
        threadId: o.id,
      })
    }
    return
  }

  // Gold FPw stamps at cap-pass (before plan/probe). Tip stamps once a
  // fast-ack or substantive post actually lands so a failed compose/post
  // does not burn the hour.
  let stampedHourlyTurn = false
  const stampHourlyTurn = (): void => {
    if (stampedHourlyTurn) return
    stampedHourlyTurn = true
    l.turnTimestamps.push(now)
    if (l.turnTimestamps.length === 1) {
      l.capNoticed = false
      l.planModeNoticed = false
    }
  }

  const post =
    scanDeps.postReply ??
    (async args => {
      const { allowAllCanUseTool } = await import('./nzt.js')
      const r0 = await Ttn({
        url: r,
        slug: t,
        threadId: args.threadId,
        text: args.text,
        signal: args.signal ?? input.abort.signal,
        answersSummon: args.answersSummon === true,
        // densable EP after actGates probe allow — skip interactive ask on reply
        canUseTool: allowAllCanUseTool,
      })
      return r0.kind === 'posted'
        ? { kind: 'ok' as const, commentId: r0.commentId }
        : {
            kind: 'error' as const,
            message: r0.kind,
          }
    })

  const wantFastAck =
    scanDeps.fastAckEnabled?.() === true ||
    process.env.CLAUDE_CODE_ARTIFACT_COMMENT_FAST_ACK_FIXED === '1' ||
    process.env.CLAUDE_CODE_ARTIFACT_COMMENT_FAST_ACK_FIXED === 'true'

  if (wantFastAck) {
    let ackText: string | null = FAST_ACK_TEXT
    if (scanDeps.composeAutoReply) {
      try {
        const composed = await scanDeps.composeAutoReply({
          slug: t,
          url: r,
          thread: o,
          newComments,
          phase: 'fast_ack',
          signal: input.abort.signal,
        })
        if (composed && composed.trim()) ackText = composed.trim()
      } catch {
        /* keep fixed */
      }
    }
    const ack = await post({
      slug: t,
      threadId: o.id,
      text: ackText,
      signal: input.abort.signal,
      answersSummon,
    })
    if (ack.kind === 'ok') {
      stampHourlyTurn()
      c.consecutiveAuto++
      c.consecutivePipelineDenials = 0
      c.lastAutoReplyAt = Date.now()
      if (ack.commentId) c.ownReplyIds.add(ack.commentId)
      bumpUnattendedReply(t)
      l.pipelineDeniedNoticed = false
      coalesceNotice({
        slug: t,
        family: 'artifact-auto-react',
        artifactName: n,
        detail: `Acknowledgement reply posted to thread ${o.id} on artifact ${r}; the substantive auto-reply is still being composed and is reported separately.`,
        mergeDetails: 'append',
        threadId: o.id,
      })
      if (c.consecutiveAuto >= CONSECUTIVE_AUTO_BREAKER) c.breakerOpen = true
    } else {
      c.consecutivePipelineDenials++
    }
  }

  if (c.breakerOpen) return

  let text: string | null = null
  if (scanDeps.composeAutoReply) {
    try {
      text = await scanDeps.composeAutoReply({
        slug: t,
        url: r,
        thread: o,
        newComments,
        phase: 'substantive',
        signal: input.abort.signal,
      })
    } catch {
      c.consecutivePipelineDenials++
      return
    }
  } else if (
    process.env.CLAUDE_CODE_ARTIFACT_AUTOREACT_AUTOREPLY === '1' ||
    process.env.CLAUDE_CODE_ARTIFACT_AUTOREACT_AUTOREPLY === 'true'
  ) {
    text =
      'Thanks — I saw your comment and will follow up from this Claude Code session.'
  }

  if (!text?.trim()) return

  const posted = await post({
    slug: t,
    threadId: o.id,
    text: text.trim(),
    signal: input.abort.signal,
    answersSummon,
  })
  if (posted.kind === 'ok') {
    stampHourlyTurn()
    c.consecutiveAuto++
    c.consecutivePipelineDenials = 0
    c.lastAutoReplyAt = Date.now()
    if (posted.commentId) c.ownReplyIds.add(posted.commentId)
    bumpUnattendedReply(t)
    l.pipelineDeniedNoticed = false
    coalesceNotice({
      slug: t,
      family: 'artifact-auto-react',
      artifactName: n,
      detail: `Auto-reply posted to thread ${o.id} on artifact ${r}.`,
      mergeDetails: 'append',
      threadId: o.id,
    })
    if (c.consecutiveAuto >= CONSECUTIVE_AUTO_BREAKER) c.breakerOpen = true
  } else {
    c.consecutivePipelineDenials++
  }
}

/** Test helper — force immediate UPw without coalesce. */
export async function runCommentScanNow(args: WakeArgs): Promise<void> {
  await UPw(args)
}

/** Expose digest for tests. */
export function digestForTests(
  threads: ArtifactThread[],
  own: Map<string, Set<string>>,
): string | null {
  return digestCommentThreads(threads, own)
}

export function hashSeed(): string {
  return createHash('sha256').update('seed').digest('hex')
}
