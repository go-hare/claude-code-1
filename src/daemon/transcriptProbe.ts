/**
 * densable 2.1.212 transcript probes used by job_respawn (`Xyr` / `IAe` / `NPn`).
 *
 * - NPn: file has at least one user|assistant jsonl line → hasMessages
 * - IAe: resolve transcript path via linkScan / project dirs / computed path
 * - Xyr refuse: fork handoff whose own transcript never materialized
 * - BJe: quarantine empty transcript via rename → `.orphaned-<ts>-<uuid>.jsonl`
 * - gpn: queue initialPrompt onto job state as `queuedPrompt`
 */

import { randomUUID } from 'crypto'
import { createReadStream } from 'fs'
import { lstat, open, readdir, rename, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { createInterface } from 'readline'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
// Portable project dir — avoid sessionStorage bootstrap side effects in daemon.
import { getProjectDir } from '../utils/sessionStoragePortable.js'
import type { BgJobState } from './jobState.js'

/** densable Be("job_respawn","fork_transcript_never_materialized") */
export const FORK_TRANSCRIPT_NEVER_MATERIALIZED =
  'fork_transcript_never_materialized' as const

/** densable Be("job_respawn","dead_epoch_transcript_gone") */
export const DEAD_EPOCH_TRANSCRIPT_GONE = 'dead_epoch_transcript_gone' as const

/**
 * densable Xyr error string (CLI `claude respawn` wording).
 * FleetView remaps to tYo banner; keep this for non-Fleet callers.
 */
export function formatForkTranscriptNeverMaterializedError(
  short: string,
): string {
  return (
    `This session has no saved transcript — it was stopped before its first ` +
    `response finished. If it was backgrounded from another conversation, ` +
    `that one is still intact; \`claude respawn ${short}\` starts this one fresh.`
  )
}

/**
 * densable 2.1.248 #17 p$e error @189672901.
 * Fleet remaps to ip (FLEET_DEAD_EPOCH_GONE); keep this command form for
 * daemon / `claude respawn`.
 */
export function formatDeadEpochTranscriptGoneError(short: string): string {
  return `This session's saved conversation is no longer on disk (it ended while the background service was off, and old transcripts are cleaned up), so there is nothing to resume. \`claude rm ${short}\` deletes the row; \`claude respawn ${short}\` runs its original prompt again instead.`
}

/** densable fleet tYo banner (UI). */
export const FLEET_FORCE_RESTART_MSG =
  'Press enter again to restart this session fresh — it has no saved transcript (stopped before its first response; any conversation it was backgrounded from is untouched).'

export type TranscriptProbeResult = {
  path: string
  hasMessages: boolean
  via:
    | 'linkScanPath'
    | 'linkScanDir'
    | 'projectDir'
    | 'computed'
    | 'worktreeProjectDir'
    | 'projectsScan'
    | 'absolute'
    | 'invalid'
}

/**
 * densable `$yi` — probe a path for transcript content.
 * - not a file (dir / symlink-to-dir / missing) → `none`
 * - unreadable / open-read errors → `unknown` (≠ missing; Dyi treats as present)
 * - readable with user|assistant line → `has`
 * - readable empty / metadata-only → `none`
 *
 * densable 2.1.214 #30: directory named `*.jsonl` must be `none`, never treated
 * as a restorable transcript (access/existsSync alone would accept it).
 */
export type TranscriptPresence = 'none' | 'has' | 'unknown'

export async function probeTranscriptPresence(
  filePath: string,
): Promise<TranscriptPresence> {
  try {
    const st = await lstat(filePath)
    if (!st.isFile()) return 'none'
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      return 'none'
    }
    // densable $yi: non-ENOENT lstat → unknown
    return 'unknown'
  }

  let stream: ReturnType<typeof createReadStream> | undefined
  try {
    stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const line of rl) {
        if (
          line.includes('"type":"user"') ||
          line.includes('"type":"assistant"')
        ) {
          return 'has'
        }
      }
      return 'none'
    } finally {
      rl.close()
    }
  } catch {
    // densable $yi: catch after open → unknown
    return 'unknown'
  } finally {
    stream?.destroy()
  }
}

/**
 * densable `Dyi` / NPn — true when path is not known-absent.
 * `unknown` counts as present so reopen does not false-refuse on flaky I/O.
 */
export async function transcriptHasMessages(
  filePath: string,
): Promise<boolean> {
  return (await probeTranscriptPresence(filePath)) !== 'none'
}

function isUuidLike(id: string): boolean {
  // densable h$ / Fw — reject empty / path-like as invalid resume id
  if (!id || id.includes('/') || id.includes('\\') || id.endsWith('.jsonl')) {
    return false
  }
  return id.length >= 8
}

/**
 * densable `gTe` / IAe(sessionId, cwd, linkScanPath?, opts?) —
 * locate transcript + hasMessages.
 *
 * densable 2.1.214 #30 unreadable-folder reopen:
 * - primary candidates use Dyi (≠ none)
 * - projectsScan rescue only counts `$yi === "has"` and only when exactly one hit
 * - never return a directory path via bare access()/existsSync
 */
export async function probeResumeTranscript(
  sessionId: string,
  cwd: string,
  linkScanPath?: string,
  opts?: { crossWorktree?: boolean },
): Promise<TranscriptProbeResult> {
  // Absolute snapshot path (keepParent fork)
  if (
    sessionId.endsWith('.jsonl') ||
    sessionId.endsWith('.json') ||
    sessionId.includes('/') ||
    sessionId.includes('\\')
  ) {
    const has = await transcriptHasMessages(sessionId)
    return {
      path: sessionId,
      hasMessages: has,
      via: 'absolute',
    }
  }

  if (!isUuidLike(sessionId)) {
    const computed = join(
      getProjectDir(cwd || process.cwd()),
      'invalid-resume-id.jsonl',
    )
    return { path: computed, hasMessages: false, via: 'invalid' }
  }

  const candidates: Array<{
    path: string
    via: TranscriptProbeResult['via']
  }> = []

  if (linkScanPath) {
    if (linkScanPath.endsWith(`${sessionId}.jsonl`)) {
      candidates.push({ path: linkScanPath, via: 'linkScanPath' })
    } else {
      candidates.push({
        path: join(dirname(linkScanPath), `${sessionId}.jsonl`),
        via: 'linkScanDir',
      })
    }
  }

  try {
    const projectDir = getProjectDir(cwd || process.cwd())
    candidates.push({
      path: join(projectDir, `${sessionId}.jsonl`),
      via: 'projectDir',
    })
  } catch {
    // ignore
  }

  // densable: always keep a computed path as last primary candidate
  const computedPath = join(
    getProjectDir(cwd || process.cwd()),
    `${sessionId}.jsonl`,
  )
  candidates.push({ path: computedPath, via: 'computed' })

  const seen = new Set<string>()
  for (const c of candidates) {
    if (seen.has(c.path)) continue
    seen.add(c.path)
    // densable Dyi — present if not known-absent
    if (await transcriptHasMessages(c.path)) {
      return { ...c, hasMessages: true }
    }
  }

  // densable gTe projectsScan rescue (crossWorktree default true):
  // only isDirectory entries; only $yi === "has"; only when unique hit.
  // Unreadable sibling project folders are skipped (readdir catch / $yi none).
  if (opts?.crossWorktree !== false) {
    try {
      const projectsDir = join(getClaudeConfigHomeDir(), 'projects')
      const hits: string[] = []
      const dirs = await readdir(projectsDir, { withFileTypes: true })
      for (const d of dirs) {
        // densable: `if (!u.isDirectory()) continue` — not symlink
        if (!d.isDirectory()) continue
        const path = join(projectsDir, d.name, `${sessionId}.jsonl`)
        if (seen.has(path)) continue
        if ((await probeTranscriptPresence(path)) === 'has') {
          hits.push(path)
        }
      }
      if (hits.length === 1) {
        return {
          path: hits[0]!,
          via: 'projectsScan',
          hasMessages: true,
        }
      }
    } catch {
      // densable: catch entire projectsScan → fall through
    }
  }

  // densable: no messages — return first primary candidate (not a dir hit)
  return {
    ...(candidates[0] ?? {
      path: computedPath,
      via: 'computed' as const,
    }),
    hasMessages: false,
  }
}

export type RespawnTranscriptGateInput = {
  short: string
  sessionId: string
  /** densable resumeSessionId ?? sessionId */
  resumeSessionId?: string
  cwd: string
  bgIsolation?: 'none' | 'worktree' | 'default' | string
  linkScanPath?: string
  /** densable t?.force */
  force?: boolean
  /** densable t?.forceRefusalRetry — second enter after tYo */
  forceRefusalRetry?: boolean
  /** When true, caller already chose launch.mode=prompt (fresh). */
  forceFreshPrompt?: boolean
  /**
   * densable g.deadEpochReapedAt — dead-epoch refuse when transcript is gone
   * and resumeSessionId is not pointing elsewhere (R).
   */
  deadEpochReapedAt?: string
}

export type RespawnTranscriptRefuseCode =
  | typeof FORK_TRANSCRIPT_NEVER_MATERIALIZED
  | typeof DEAD_EPOCH_TRANSCRIPT_GONE

export type RespawnTranscriptGate =
  | { allow: true; probe: TranscriptProbeResult }
  | {
      allow: false
      errorCode: RespawnTranscriptRefuseCode
      error: string
      probe: TranscriptProbeResult
    }

/**
 * densable BJe — rename empty/unmaterialized transcript out of the way so a
 * fresh session can write the same path. Returns true when rename succeeded.
 */
export async function quarantineOrphanTranscript(
  transcriptPath: string,
): Promise<boolean> {
  if (!transcriptPath) return false
  const base = transcriptPath.endsWith('.jsonl')
    ? transcriptPath.slice(0, -6)
    : transcriptPath
  const dest = `${base}.orphaned-${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`
  try {
    await rename(transcriptPath, dest)
    return true
  } catch {
    return false
  }
}

/**
 * SEA yXe(r, e): true when a reply cannot be queued across a restart —
 * bash (!), slash command (/), or answering a multi-choice question block.
 */
export function isUnqueueableReply(
  text: string,
  state: BgJobState | null,
): boolean {
  const trimmed = text.trimStart()
  return (
    trimmed.startsWith('!') ||
    trimmed.startsWith('/') ||
    (state?.tempo === 'blocked' && (state.block?.questions?.length ?? 0) > 0)
  )
}

/**
 * SEA WIt(r): drop queuedPrompt if it starts with / or ! (unqueueable).
 */
export function sanitizeQueuedPrompt(
  state: Pick<BgJobState, 'queuedPrompt'>,
): string | undefined {
  return state.queuedPrompt !== undefined &&
    isUnqueueableReply(state.queuedPrompt, null)
    ? undefined
    : state.queuedPrompt
}

/**
 * SEA SXo(r, e): true if `existing` already equals or ends with `\n\n${next}`.
 */
export function endsWithQueuedReply(existing: string, next: string): boolean {
  return existing === next || existing.endsWith(`\n\n${next}`)
}

/**
 * SEA zfe(r, e, s, E, h) — persist queuedPrompt for a later
 * successful respawn. Returns true when the write succeeded.
 */
export async function queueRespawnInitialPrompt(
  short: string,
  state: BgJobState,
  initialPrompt: string,
  keepQueuedPrompt?: boolean,
): Promise<boolean> {
  if (!short || !initialPrompt || isUnqueueableReply(initialPrompt, null)) {
    return false
  }
  try {
    const { writeBgJobState } = await import('./jobState.js')
    const prev = keepQueuedPrompt ? sanitizeQueuedPrompt(state) : undefined
    const queuedPrompt = !prev
      ? initialPrompt
      : endsWithQueuedReply(prev, initialPrompt)
        ? prev
        : `${prev}\n\n${initialPrompt}`
    writeBgJobState(short, {
      ...state,
      queuedPrompt,
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch {
    return false
  }
}

/**
 * SEA Xyr `$` prompt selection for spawn argv:
 *   keepQueuedPrompt && initialPrompt && sanitizedQueued
 *     ? (SXo(sanitizedQueued, initialPrompt) ? sanitizedQueued : `${sanitizedQueued}\n\n${initialPrompt}`)
 *     : initialPrompt ?? sanitizedQueued ?? (skipIntentReplay ? undefined : intent)
 *
 * skipIntentReplay: `Ae || tt || Ee` — hasMessages, resumeSessionId points
 * elsewhere, or fresh no-transcript respawn (bgIsolation === 'none' / forceRefusalRetry).
 */
export function resolveRespawnLaunchPrompt(opts: {
  initialPrompt?: string | null
  queuedPrompt?: string | null
  intent?: string | null
  /** Do not fall back to intent */
  skipIntentReplay?: boolean
  keepQueuedPrompt?: boolean
}): string | undefined {
  const fromInitial = opts.initialPrompt?.trim()
  const sanitizedQueued = sanitizeQueuedPrompt({
    queuedPrompt: opts.queuedPrompt ?? undefined,
  })?.trim()
  if (opts.keepQueuedPrompt && fromInitial && sanitizedQueued) {
    return endsWithQueuedReply(sanitizedQueued, fromInitial)
      ? sanitizedQueued
      : `${sanitizedQueued}\n\n${fromInitial}`
  }
  if (fromInitial) return fromInitial
  if (sanitizedQueued) return sanitizedQueued
  if (opts.skipIntentReplay) return undefined
  const fromIntent = opts.intent?.trim()
  return fromIntent || undefined
}

/**
 * densable Xyr success path: `queuedPrompt: void 0` after spawn argv is built.
 * Clears so a later resume does not re-fire a one-shot queued turn.
 */
export async function clearQueuedPrompt(short: string): Promise<boolean> {
  if (!short) return false
  try {
    const { readBgJobState, patchBgJobState } = await import('./jobState.js')
    const state = readBgJobState(short)
    if (!state || state.queuedPrompt === undefined) return false
    // patchBgJobState treats explicit undefined as delete (densable void 0).
    patchBgJobState(short, { queuedPrompt: undefined })
    return true
  } catch {
    return false
  }
}

const CONTINUED_IN_MARKER = '"type":"continued-in"'
const PARENT_UUID_MARKER = '"parentUuid":'
const ZXI_BATCH_SIZE = 32

/**
 * Gold 2.1.325 `MOr(tail)`: scan tail lines backwards for a
 * `{"type":"continued-in","continuedInSessionId":...}` record before any
 * real assistant/user message. Returns the continuedInSessionId if found.
 */
export function findContinuedInSessionId(tail: string): string | undefined {
  if (!tail.includes(CONTINUED_IN_MARKER)) return undefined
  let end = tail.length
  while (end > 0) {
    const nl = tail.lastIndexOf('\n', end - 1)
    const line = tail.slice(nl + 1, end)
    end = nl
    const hasContinued = line.includes(CONTINUED_IN_MARKER)
    const hasTurn =
      line.includes('"type":"user"') || line.includes('"type":"assistant"')
    if (hasContinued || hasTurn) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (
          hasContinued &&
          parsed.type === 'continued-in' &&
          typeof parsed.continuedInSessionId === 'string' &&
          parsed.continuedInSessionId.length > 0
        ) {
          return parsed.continuedInSessionId
        }
        if (hasTurn) {
          const msg = parsed.message as { stop_reason?: unknown } | undefined
          if (
            parsed.type === 'assistant' &&
            parsed.isApiErrorMessage !== true &&
            typeof msg?.stop_reason === 'string'
          ) {
            return undefined
          }
          if (parsed.type === 'user') {
            return undefined
          }
        }
      } catch {
        // ignore malformed JSONL line
      }
    }
    if (nl < 0) break
  }
  return undefined
}

/**
 * Gold 2.1.325 `Zxi(projectsDir, sessionId)`: scan `.jsonl` transcripts in
 * `projectsDir` in batches of 32 for a parked transcript whose tail carries a
 * `continued-in` pointer to `sessionId` and has a `parentUuid` message.
 */
export async function scanParkedContinuedInTranscript(
  projectsDir: string,
  targetSessionId: string,
): Promise<string | undefined> {
  let entries: string[]
  try {
    entries = await readdir(projectsDir)
  } catch {
    return undefined
  }
  const files = entries
    .filter(name => name.endsWith('.jsonl'))
    .map(name => join(projectsDir, name))

  for (let i = 0; i < files.length; i += ZXI_BATCH_SIZE) {
    const batch = files.slice(i, i + ZXI_BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async filePath => {
        try {
          const st = await stat(filePath)
          if (!st.isFile() || st.size === 0) return undefined
          const headSize = Math.min(st.size, 65_536)
          const tailOffset = Math.max(0, st.size - 65_536)
          const fh = await open(filePath, 'r')
          try {
            const headBuf = Buffer.allocUnsafe(headSize)
            const headRes = await fh.read(headBuf, 0, headSize, 0)
            const head = headBuf.toString('utf8', 0, headRes.bytesRead)
            let tail = head
            if (tailOffset > 0) {
              const tailLen = st.size - tailOffset
              const tailBuf = Buffer.allocUnsafe(tailLen)
              const tailRes = await fh.read(tailBuf, 0, tailLen, tailOffset)
              tail = tailBuf.toString('utf8', 0, tailRes.bytesRead)
            }
            if (findContinuedInSessionId(tail) !== targetSessionId) {
              return undefined
            }
            if (
              head.includes(PARENT_UUID_MARKER) ||
              tail.includes(PARENT_UUID_MARKER)
            ) {
              return filePath
            }
            return undefined
          } finally {
            await fh.close()
          }
        } catch {
          return undefined
        }
      }),
    )
    const match = results.find(r => r !== undefined)
    if (match !== undefined) return match
  }
  return undefined
}

/**
 * densable Xyr core refuse condition (without full kill/alive machinery):
 * !hasMessages && bgIsolation==="none" && resumeId===sessionId
 * && !force && !forceRefusalRetry
 *
 * When refuse is NOT taken but transcript has no messages, densable still runs
 * BJe orphan rename before continuing with a fresh spawn.
 */
export async function evaluateRespawnTranscriptGate(
  input: RespawnTranscriptGateInput,
): Promise<RespawnTranscriptGate> {
  const resumeId = input.resumeSessionId ?? input.sessionId
  let probe = await probeResumeTranscript(
    resumeId,
    input.cwd,
    input.linkScanPath,
  )

  if (probe.hasMessages) {
    return { allow: true, probe }
  }

  const isolation = input.bgIsolation ?? 'none'
  let parkedMatch: string | undefined
  if (
    !probe.hasMessages &&
    isolation === 'none' &&
    !input.forceFreshPrompt &&
    input.linkScanPath === undefined
  ) {
    parkedMatch = await scanParkedContinuedInTranscript(
      dirname(probe.path),
      input.sessionId,
    )
    const reprobe = await probeResumeTranscript(
      resumeId,
      input.cwd,
      input.linkScanPath,
    )
    if (reprobe.hasMessages) {
      probe = reprobe
      parkedMatch = undefined
      return { allow: true, probe }
    }
  }

  const forced =
    input.force || input.forceRefusalRetry || input.forceFreshPrompt
  // densable: only refuse fork-handoff same-tree when resume id is the job's own session
  if (
    parkedMatch === undefined &&
    !forced &&
    isolation === 'none' &&
    resumeId === input.sessionId
  ) {
    return {
      allow: false,
      errorCode: FORK_TRANSCRIPT_NEVER_MATERIALIZED,
      error: formatForkTranscriptNeverMaterializedError(input.short),
      probe,
    }
  }

  // densable p$e: deadEpochReapedAt && !force && !R (R = resumeId points elsewhere).
  // forceRefusalRetry does NOT bypass this refuse.
  const resumePointsElsewhere =
    input.resumeSessionId !== undefined &&
    input.resumeSessionId !== input.sessionId
  if (
    parkedMatch === undefined &&
    input.deadEpochReapedAt !== undefined &&
    !input.force &&
    !resumePointsElsewhere
  ) {
    return {
      allow: false,
      errorCode: DEAD_EPOCH_TRANSCRIPT_GONE,
      error: formatDeadEpochTranscriptGoneError(input.short),
      probe,
    }
  }

  // densable Xyr non-refuse empty-transcript path: BJe orphan rename + continue
  await quarantineOrphanTranscript(probe.path)
  return { allow: true, probe }
}
