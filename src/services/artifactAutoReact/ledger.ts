/**
 * densable autoReact ledger I/O — A3i / RAm / $ot / HAm / hkl / yAm / PAm / gkl / mkl.
 * Source: gold-mkl-ledger-239 / gold-A3i-239 / gold-ykl-239 / gold-dollar-ot-239.
 *
 * densable ykl → Rc().appendEntry (storageV5). Tip: when ledgerStorageV5.appendEntry
 * is set (IAm), write through it; else JSON under
 * `~/.claude/autoreact-ledgers/<sessionId>.json`.
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { Jj, M2 } from './gates.js'
import { type LedgerArtifactSnapshot, type PendingLedger, un } from './store.js'

/** densable bAm — debounce default 10s. */
export const LEDGER_DEBOUNCE_MS = 10_000
/** densable _Am — min rewrite / defer window 1h. */
export const LEDGER_REWRITE_MIN_MS = 3_600_000
/** densable vAm — future skew tolerance 5m. */
export const LEDGER_FUTURE_SKEW_MS = 300_000
/** densable cHw — max age 1d (TAm stand-in). */
export const LEDGER_MAX_AGE_MS = 86_400_000
/** densable SAm — max artifacts in envelope. */
export const LEDGER_ARTIFACT_CAP = 64

export type AutoreactLedgerEnvelope = {
  type: 'artifact-autoreact-ledger'
  v: 1
  sessionId: string
  accountUuid: string | null
  artifacts: Record<string, LedgerArtifactSnapshot>
}

function sessionId(): string {
  try {
    return getSessionId()
  } catch {
    return process.env.CLAUDE_CODE_SESSION_ID ?? 'local'
  }
}

function accountUuid(): string | null {
  return process.env.CLAUDE_ACCOUNT_UUID ?? null
}

function ledgerDir(): string {
  return join(getClaudeConfigHomeDir(), 'autoreact-ledgers')
}

export function ledgerFilePath(sid: string = sessionId()): string {
  return join(ledgerDir(), `${sid}.json`)
}

/** densable T3i — strip threads / high-water (interrupt truncate). */
export function truncateLedgerArtifact(
  e: LedgerArtifactSnapshot,
): LedgerArtifactSnapshot {
  return {
    savedAt: e.savedAt,
    stampHighWater: null,
    everBaselined: false,
    everHadThreads: e.everHadThreads,
    turnTimestamps: e.turnTimestamps,
    threads: [],
  }
}

/** densable gHw — interrupted empty snapshot. */
export function interruptedLedgerArtifact(
  savedAt: number,
): LedgerArtifactSnapshot {
  return {
    savedAt,
    stampHighWater: null,
    everBaselined: false,
    everHadThreads: false,
    turnTimestamps: [],
    threads: [],
    interrupted: true,
  }
}

async function readLedgerFile(
  sid: string,
): Promise<AutoreactLedgerEnvelope | null> {
  try {
    const raw = await readFile(ledgerFilePath(sid), 'utf8')
    const parsed = JSON.parse(raw) as AutoreactLedgerEnvelope
    if (parsed?.type !== 'artifact-autoreact-ledger' || parsed.v !== 1) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * densable A3i — hydrate pendingLedger from on-disk ledger for current sid.
 * Sync API: kicks async load once; returns current in-memory slugs map or null.
 */
let hydrateInFlight: Promise<void> | null = null

export function hydratePendingLedger(): Map<
  string,
  LedgerArtifactSnapshot
> | null {
  const { autoReact: e } = un()
  const t = sessionId()
  const n = accountUuid()
  if (e.pendingLedger?.sid === t && e.pendingLedger.accountUuid === n) {
    return e.pendingLedger.slugs
  }
  if (hydrateInFlight === null) {
    hydrateInFlight = (async () => {
      const file = await readLedgerFile(t)
      if (!file || file.sessionId !== t) return
      const slugs = new Map<string, LedgerArtifactSnapshot>()
      for (const [slug, snap] of Object.entries(file.artifacts ?? {})) {
        slugs.set(slug, snap)
        if (snap.interrupted === true) {
          const wakes = un().wakes
          if (!wakes.stoppedSlugs.has(slug)) {
            wakes.stoppedSlugs.add(slug)
            wakes.sweptSlugs.add(slug)
          }
        }
      }
      const ar = un().autoReact
      ar.ledgerRetiredSids.delete(t)
      ar.ledgerOwnerSid ??= t
      ar.pendingLedger = {
        sid: t,
        accountUuid: file.accountUuid ?? n,
        slugs,
      }
      ar.ledgerSupersedable = true
    })().finally(() => {
      hydrateInFlight = null
    })
  }
  const o = e.pendingLedger
  if (o?.sid === t && o.accountUuid === null) o.accountUuid = n
  return o?.sid === t && o.accountUuid === n ? o.slugs : null
}

/** densable btn */
export function ensureLedgerHydrated(): void {
  hydratePendingLedger()
}

/** densable mkl — truncate one slug's pending ledger threads. */
export function truncatePendingLedgerSlug(slug: string): void {
  hydratePendingLedger()
  const t = un().autoReact.pendingLedger?.slugs
  const r = t?.get(slug)
  if (r !== undefined) t!.set(slug, truncateLedgerArtifact(r))
}

/** densable RAm */
export function buildLedgerEnvelope(
  sid: string,
  nowMs: number,
): AutoreactLedgerEnvelope | null {
  const { autoReact: r } = un()
  const n = accountUuid()
  const artifacts: Record<string, LedgerArtifactSnapshot> = {}
  const pending = r.pendingLedger?.sid === sid ? r.pendingLedger.slugs : null
  const liveEntries = [...r.artifacts.entries()] as Array<
    [
      string,
      {
        lastScanAt?: number
        accountUuid?: string | null
      } & Partial<LedgerArtifactSnapshot>,
    ]
  >

  for (const [slug, art] of liveEntries.slice(0, LEDGER_ARTIFACT_CAP)) {
    const interrupted = !r.userDisarmed && M2(slug)
    const scrub =
      r.userDisarmed ||
      (art.accountUuid != null && art.accountUuid !== n) ||
      (Jj(slug) && !interrupted)
    artifacts[slug] = {
      savedAt: art.lastScanAt ?? art.savedAt ?? nowMs,
      stampHighWater: scrub ? null : (art.stampHighWater ?? null),
      everBaselined: scrub ? false : Boolean(art.everBaselined),
      everHadThreads: Boolean(art.everHadThreads),
      turnTimestamps: (art.turnTimestamps ?? [])
        .filter(a => nowMs - a < 3_600_000)
        .slice(-600),
      threads: scrub ? [] : art.threads,
      ...(interrupted ? { interrupted: true } : {}),
    }
  }

  if (pending) {
    for (const [slug, snap] of pending) {
      if (slug in artifacts) continue
      const age = nowMs - snap.savedAt
      if (age > LEDGER_MAX_AGE_MS || age < -LEDGER_FUTURE_SKEW_MS) continue
      artifacts[slug] = {
        ...truncateLedgerArtifact(snap),
        ...(snap.interrupted ? { interrupted: true } : {}),
      }
    }
  }

  if (Object.keys(artifacts).length === 0 && !r.ledgerSupersedable) return null
  return {
    type: 'artifact-autoreact-ledger',
    v: 1,
    sessionId: sid,
    accountUuid: n,
    artifacts,
  }
}

/** densable ykl stand-in — storageV5 appendEntry when claimed, else atomic JSON. */
export async function writeLedgerEnvelope(
  envelope: AutoreactLedgerEnvelope,
  urgent?: boolean,
): Promise<void> {
  const storage = un().autoReact.ledgerStorageV5 as
    | {
        appendEntry?: (
          entry: AutoreactLedgerEnvelope,
          sessionId?: string,
          _unused?: unknown,
          urgent?: boolean,
        ) => Promise<void> | void
      }
    | undefined
  if (typeof storage?.appendEntry === 'function') {
    await storage.appendEntry(envelope, envelope.sessionId, undefined, urgent)
    return
  }
  await mkdir(ledgerDir(), { recursive: true })
  const path = ledgerFilePath(envelope.sessionId)
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(envelope), 'utf8')
  const { rename } = await import('fs/promises')
  await rename(tmp, path)
}

function fingerprintArtifacts(
  artifacts: Record<string, LedgerArtifactSnapshot>,
): string {
  return JSON.stringify(
    Object.entries(artifacts).map(([t, r]) => [
      t,
      {
        ...r,
        savedAt: 0,
        threads: r.threads?.map(n => ({
          ...n,
          seen: n.seen.length > 0,
          sent: n.sent.filter(([, o]) => o !== null),
        })),
      },
    ]),
  )
}

/** densable yAm */
function writeLedgerForSid(
  sid: string,
  nowMs: number,
  force: boolean,
  urgent?: boolean,
): void {
  const { autoReact: n } = un()
  if (n.ledgerRetiredSids.has(sid)) return
  const o = buildLedgerEnvelope(sid, nowMs)
  if (o === null) return
  const i = fingerprintArtifacts(o.artifacts)
  if (
    !force &&
    i === n.ledgerLastWritten &&
    sid === n.ledgerLastWriteSid &&
    o.accountUuid === n.ledgerLastWriteAccount &&
    nowMs - (n.ledgerLastWriteAt ?? 0) < LEDGER_REWRITE_MIN_MS
  ) {
    return
  }
  n.ledgerLastWritten = i
  n.ledgerLastWriteAt = nowMs
  n.ledgerLastWriteSid = sid
  n.ledgerOwnerSid ??= sid
  n.ledgerLastWriteAccount = o.accountUuid
  n.ledgerSupersedable = true
  const a = writeLedgerEnvelope(o, urgent).catch(() => {
    if (n.ledgerLastWritten === i) {
      n.ledgerLastWritten = null
      n.ledgerLastWriteAt = null
    }
  })
  n.ledgerLastAppend = Promise.all([n.ledgerLastAppend, a]).then(() => {})
}

/** densable vHw / hkl */
export function flushLedgerNow(
  opts: { force?: boolean; urgent?: boolean } = {},
): void {
  const { autoReact: r } = un()
  if (r.ledgerTimer !== undefined) {
    clearTimeout(r.ledgerTimer)
    r.ledgerTimer = undefined
  }
  const n = sessionId()
  const o = r.ledgerOwnerSid ?? n
  const i = Date.now()
  if (o !== n && !opts.urgent) {
    r.ledgerDeferredSince ??= i
    if (i - r.ledgerDeferredSince < LEDGER_REWRITE_MIN_MS) {
      scheduleLedgerDebounce()
      return
    }
  }
  r.ledgerDeferredSince = null
  writeLedgerForSid(o, i, opts.force === true, opts.urgent === true)
  if (o !== n)
    writeLedgerForSid(n, i, opts.force === true, opts.urgent === true)
}

/** densable HAm */
export function scheduleLedgerDebounce(): void {
  const { autoReact: e } = un()
  const t = e.ledgerDebounceMsOverride ?? LEDGER_DEBOUNCE_MS
  if (e.ledgerTimer === undefined && t > 0) {
    e.ledgerTimer = setTimeout(() => flushLedgerNow(), t)
    e.ledgerTimer.unref?.()
  }
}

/** densable $ot */
export function scheduleLedgerWrite(opts?: { flush?: boolean }): void {
  const { autoReact: t } = un()
  const r = t.ledgerDebounceMsOverride ?? LEDGER_DEBOUNCE_MS
  if (t.ledgerOwnerSid === null || t.ledgerOwnerSid === sessionId()) {
    t.ledgerDeferredSince = null
  }
  if (opts?.flush === true || r <= 0) {
    flushLedgerNow({ urgent: opts?.flush === true })
    return
  }
  scheduleLedgerDebounce()
}

/** densable PAm — retire ledger ownership / clear pending. */
export function retireLedger(opts?: { stillCurrent?: boolean }): void {
  const { autoReact: t } = un()
  if (opts?.stillCurrent !== false) {
    if (t.ledgerOwnerSid !== null) t.ledgerRetiredSids.add(t.ledgerOwnerSid)
    t.ledgerRetiredSids.add(sessionId())
  }
  t.artifacts.clear()
  t.pendingLedger = null
  if (t.ledgerTimer !== undefined) {
    clearTimeout(t.ledgerTimer)
    t.ledgerTimer = undefined
  }
  t.ledgerExitReStamp?.()
  t.ledgerExitReStamp = undefined
  t.ledgerLastWritten = null
  t.ledgerLastWriteAt = null
  t.ledgerLastWriteSid = null
  t.ledgerLastWriteAccount = undefined
  t.ledgerFailureSeqAtWrite = null
  t.ledgerDeferredSince = null
  t.ledgerOwnerSid = null
  t.ledgerSupersedable = false
}

/** densable gkl — interrupt slug in pending + flush. */
export function interruptLedgerSlug(slug: string): void {
  truncatePendingLedgerSlug(slug)
  scheduleLedgerWrite({ flush: true })
}

/** densable IAm — claim ledger ownership for current session. */
export function claimLedgerOwnership(storageV5?: unknown): void {
  const { autoReact: t } = un()
  if (storageV5 !== undefined) t.ledgerStorageV5 = storageV5
  if (!t.ledgerRetiredSids.has(sessionId())) t.ledgerOwnerSid = sessionId()
}

/** Test/helper — seed pending ledger without disk. */
export function seedPendingLedgerForTests(ledger: PendingLedger): void {
  un().autoReact.pendingLedger = ledger
  un().autoReact.ledgerSupersedable = true
}
