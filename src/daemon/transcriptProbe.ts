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
import { lstat, readdir, rename } from 'fs/promises'
import { dirname, join } from 'path'
import { createInterface } from 'readline'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
// Portable project dir — avoid sessionStorage bootstrap side effects in daemon.
import { getProjectDir } from '../utils/sessionStoragePortable.js'
import type { BgJobState } from './jobState.js'

/** densable Be("job_respawn","fork_transcript_never_materialized") */
export const FORK_TRANSCRIPT_NEVER_MATERIALIZED =
  'fork_transcript_never_materialized' as const

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
}

export type RespawnTranscriptGate =
  | { allow: true; probe: TranscriptProbeResult }
  | {
      allow: false
      errorCode: typeof FORK_TRANSCRIPT_NEVER_MATERIALIZED
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
 * densable gpn(jobDir, state, initialPrompt) — persist queuedPrompt for a later
 * successful respawn. Returns true when the write succeeded.
 */
export async function queueRespawnInitialPrompt(
  short: string,
  state: BgJobState,
  initialPrompt: string,
): Promise<boolean> {
  if (!short || !initialPrompt) return false
  try {
    const { writeBgJobState } = await import('./jobState.js')
    writeBgJobState(short, {
      ...state,
      queuedPrompt: initialPrompt,
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch {
    return false
  }
}

/**
 * densable Xyr `$` prompt selection for spawn argv:
 *   initialPrompt ?? queuedPrompt ?? (skipIntentReplay ? undefined : intent)
 *
 * skipIntentReplay densable: `w || N` — pure resume-with-messages, or
 * resumeSessionId points at a different session than the job's own.
 * When true, intent is NOT auto-replayed (only explicit/queued prompts apply).
 */
export function resolveRespawnLaunchPrompt(opts: {
  initialPrompt?: string | null
  queuedPrompt?: string | null
  intent?: string | null
  /** densable w||N — do not fall back to intent */
  skipIntentReplay?: boolean
}): string | undefined {
  const fromInitial = opts.initialPrompt?.trim()
  if (fromInitial) return fromInitial
  const fromQueued = opts.queuedPrompt?.trim()
  if (fromQueued) return fromQueued
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
  const probe = await probeResumeTranscript(
    resumeId,
    input.cwd,
    input.linkScanPath,
  )

  if (probe.hasMessages) {
    return { allow: true, probe }
  }

  // force / forceRefusalRetry / explicit fresh prompt → allow (starts clean)
  // densable still BJe-quarantines empty transcript on the non-refuse path.
  if (input.force || input.forceRefusalRetry || input.forceFreshPrompt) {
    await quarantineOrphanTranscript(probe.path)
    return { allow: true, probe }
  }

  const isolation = input.bgIsolation ?? 'none'
  // densable: only refuse fork-handoff same-tree when resume id is the job's own session
  if (isolation === 'none' && resumeId === input.sessionId) {
    return {
      allow: false,
      errorCode: FORK_TRANSCRIPT_NEVER_MATERIALIZED,
      error: formatForkTranscriptNeverMaterializedError(input.short),
      probe,
    }
  }

  // densable Xyr non-refuse empty-transcript path: BJe orphan rename + continue
  await quarantineOrphanTranscript(probe.path)
  return { allow: true, probe }
}
