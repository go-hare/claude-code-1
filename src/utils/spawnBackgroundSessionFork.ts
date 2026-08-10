/**
 * densable 2.1.212 `/fork` — `D$t(..., { keepParent: true })` via=`fork_session`.
 *
 * Copy the current conversation into a new background session (own row in
 * `claude agents`) while the main REPL continues.
 *
 * densable body (binary ~243588362 / L2p / nZ_):
 *   - nZ_ guards: coordinator, persistence off, restricted launch, M9e seed
 *   - Flush 10s hard fail; D6e boundary best-effort
 *   - Snapshot parent transcript → jobs/<short>/tmp/parent-transcript.jsonl
 *   - keepParent worktree relocate: child cwd = originalCwd; parent keeps wt
 *   - Job: forkSourceAlive + boundary/ids + bgIsolation "default"
 *   - CLI inherit: --permission-mode, --model, --effort, --add-dir, tools,
 *     --append-system-prompt (isolation), -- <prompt>
 *   - submitDispatch resume path + forkSession + providedSessionId
 */

import { feature } from 'bun:bundle'
import { randomUUID, type UUID } from 'crypto'
import { copyFile, mkdir, rm } from 'fs/promises'
import { dirname, isAbsolute, join } from 'path'
import {
  getOriginalCwd,
  getSessionId,
  isSessionPersistenceDisabled,
} from '../bootstrap/state.js'
import { isCoordinatorMode } from '../coordinator/coordinatorMode.js'
import { FORK_GLYPH } from '../constants/figures.js'
import {
  deriveBackgroundSeed,
  type BackgroundSeed,
  type BackgroundSeedMessage,
} from '../cli/bg/helpers.js'
import { isBareMode } from './envUtils.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import { isSafeModeEnabled } from './safeMode.js'
import {
  flushSessionStorage,
  getCurrentSessionTitle,
  getTranscriptPath,
  recordForkBoundaryLeaf,
} from './sessionStorage.js'
import {
  getForkReplayLaunchConfig,
  getForkRestrictedLaunchConfig,
  getReplConfigArgv,
  mergeForkReplayIntoChildArgs,
} from './forkReplayLaunchConfig.js'
import { findGitRoot } from './git.js'
import { getMainLoopModel } from './model/model.js'
import { isAutoMemoryEnabled } from '../memdir/paths.js'
import { getCurrentWorktreeSession } from './worktree.js'

/** densable keepParent flush cap (ms) — D$t uses 10000 when keepParent. */
export const KEEP_PARENT_FLUSH_CAP_MS = 10_000

/** densable nZ_ restricted-launch refusal (Pl || lf || Hei). */
export const FORK_RESTRICTED_LAUNCH_ERROR =
  "Cannot fork — this session was started with launch flags (safe or bare mode, a custom system prompt, a tool allowlist, or restricted settings) that the copy wouldn't inherit, so it would run with fewer restrictions than this session. Run the task here, or start a session without those flags and fork from there."

export const FORK_PERSISTENCE_OFF_ERROR =
  'Cannot fork — session persistence is off, so the new session would have nothing to start from.'

export const FORK_NOTHING_YET_ERROR =
  'Nothing to fork yet — send a message first.'

/**
 * densable `pwd` / `deriveForkName` (2.1.212 binary):
 * first 3 tokens, lowercased, non-alnum stripped, max 24, fallback "fork".
 */
export function deriveForkName(prompt: string): string {
  return (
    prompt
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'fork'
  )
}

/**
 * densable `Jd(ru(pm(t)), 60)` — collapse whitespace, ≤60.
 */
export function collapseForkPromptLabel(prompt: string, max = 60): string {
  const one = prompt.replace(/\s+/g, ' ').trim()
  if (!one) return ''
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/**
 * densable nZ_ restricted half: Pl()||lf()||Hei().
 *
 * Prefer sticky Hei (`getForkRestrictedLaunchConfig` / xei at launch). Fall
 * back to argv scan when launch never set the sticky bit (tests / late import).
 */
export function isForkRestrictedLaunch(
  argv: readonly string[] = process.argv,
): boolean {
  if (isSafeModeEnabled(process.env, argv)) return true
  if (isBareMode()) return true
  // densable Hei() — sticky from xei(Ajs(options)) at launch
  if (getForkRestrictedLaunchConfig()) return true
  // Fallback portable argv scan (tests without main.tsx Iei/xei)
  const flags = [
    '--system-prompt',
    '--system-prompt-file',
    '--append-system-prompt-file',
    '--permission-prompt-tool',
    '--setting-sources',
    '--managed-settings',
  ]
  for (const f of flags) {
    if (argv.includes(f)) return true
  }
  const toolsIdx = argv.indexOf('--tools')
  if (toolsIdx >= 0) {
    const val = argv[toolsIdx + 1]
    if (val && val !== 'default' && !val.startsWith('-')) return true
  }
  return false
}

/**
 * densable M9e(messages, prompt, "(forked)") — seed for /fork.
 * null when nothing to fork (no user turn and empty prompt).
 */
export function deriveForkSessionSeed(
  messages: readonly BackgroundSeedMessage[],
  prompt: string,
  options?: {
    sessionTitle?: string | null
    sessionAiTitle?: string | null
    agentColor?: string
  },
): BackgroundSeed | null {
  const seed = deriveBackgroundSeed(messages, prompt.trim(), {
    sessionTitle: options?.sessionTitle,
    sessionAiTitle: options?.sessionAiTitle,
    agentColor: options?.agentColor,
  })
  if (!seed) return null
  // densable M9e default label when empty is "(forked)" not "(backgrounded)"
  if (seed.intent === '(backgrounded)' && !prompt.trim()) {
    return { ...seed, intent: '(forked)' }
  }
  return seed
}

/** densable nZ_ preflight — pure string error or null if ok. */
export function getForkSessionPreflightError(opts: {
  isCoordinator?: boolean
  persistenceDisabled?: boolean
  restrictedLaunch?: boolean
  /** densable 2.1.214 endedByModel — refuse /fork after EndConversation. */
  endedByModel?: boolean
  seed: BackgroundSeed | null
}): string | null {
  if (opts.endedByModel) {
    // Same product string as processUserInput / compact refuse gates.
    try {
      const { END_CONVERSATION_SESSION_ENDED_MESSAGE } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@claude-code/builtin-tools/tools/EndConversationTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/EndConversationTool/prompt.js')
      return END_CONVERSATION_SESSION_ENDED_MESSAGE
    } catch {
      return 'Claude ended this conversation. Start a new session (or /clear) to continue.'
    }
  }
  if (opts.isCoordinator) {
    return 'Forking is not available in coordinator sessions. Use /branch instead.'
  }
  if (opts.persistenceDisabled) {
    return FORK_PERSISTENCE_OFF_ERROR
  }
  if (opts.restrictedLaunch) {
    return FORK_RESTRICTED_LAUNCH_ERROR
  }
  if (opts.seed === null) {
    return FORK_NOTHING_YET_ERROR
  }
  return null
}

export type SpawnBackgroundSessionForkResult =
  | {
      ok: true
      short: string
      sessionId: string
      name: string
      /** densable editsIn when not relocated. */
      editsIn?: 'this-tree' | 'own-worktree'
      relocatedTo?: string
      relocatedFrom?: 'entered' | 'owned' | 'launched'
      hadWorktree: boolean
      /** True when /fork prompt was non-empty (child starts working). */
      hadPrompt: boolean
    }
  | {
      ok: false
      error: string
      reason?: string
    }

/**
 * densable keepParent name: seed.name + KW + promptLabel, or KW + label, or seed.
 */
export function resolveKeepParentForkName(opts: {
  seedName?: string
  seedNameSource?: 'user' | 'auto'
  prompt: string
}): { name: string; nameSource: 'user' | 'auto' } {
  const promptLabel = opts.prompt ? collapseForkPromptLabel(opts.prompt) : ''
  if (opts.seedName) {
    if (promptLabel) {
      return {
        name: `${opts.seedName} ${FORK_GLYPH} ${promptLabel}`.slice(0, 80),
        nameSource: 'auto',
      }
    }
    return {
      name: opts.seedName.slice(0, 60),
      nameSource: opts.seedNameSource ?? 'user',
    }
  }
  if (promptLabel) {
    return {
      name: `${FORK_GLYPH} ${promptLabel}`.slice(0, 60),
      nameSource: 'auto',
    }
  }
  return { name: 'fork', nameSource: 'auto' }
}

/** densable `Npn` — middle-dot join for one-line session toasts. */
export const FORK_SESSION_TOAST_SEP = ' · '

/** densable `Mpn` / `Tyr` / `h6y` state labels. */
export const FORK_SESSION_STATE_RUNNING = 'session running'
export const FORK_SESSION_STATE_WAITING_PROMPT = 'session waiting for a prompt'
export const FORK_SESSION_STATE_WAITING = 'session waiting'

/** densable chip when fork `editsIn === "this-tree"` (shared checkout note). */
export const FORK_SESSION_CHIP_EDITS_THIS_CHECKOUT = 'edits this checkout'
/** densable chip when fork relocated back to origin tree. */
export const FORK_SESSION_CHIP_RUNS_ORIGIN = 'runs in the origin tree'

/**
 * densable `rBo` — one-line join:
 *   [state, name?, id?, ...chips].join(" · ")
 */
export function formatSessionStatusLine(parts: {
  state: string
  name?: string
  id?: string
  chips?: string[]
}): string {
  return [
    parts.state,
    ...(parts.name ? [parts.name] : []),
    ...(parts.id ? [parts.id] : []),
    ...(parts.chips ?? []),
  ].join(FORK_SESSION_TOAST_SEP)
}

/**
 * densable `HXs` — parse one-line rBo toast; rejects multiline.
 * id is last 8-hex token; chips follow id.
 */
export function parseSessionStatusLine(text: string): {
  state: string
  name?: string
  id?: string
  chips: string[]
} | null {
  if (
    !text.startsWith(FORK_SESSION_STATE_RUNNING) &&
    !text.startsWith(FORK_SESSION_STATE_WAITING_PROMPT)
  ) {
    return null
  }
  if (text.includes('\n')) return null
  const t = text.split(FORK_SESSION_TOAST_SEP)
  const r = t[0]
  if (
    r !== FORK_SESSION_STATE_RUNNING &&
    r !== FORK_SESSION_STATE_WAITING_PROMPT
  ) {
    return null
  }
  const hex8 = /^[0-9a-f]{8}$/
  let n = -1
  for (let i = t.length - 1; i >= 0; i--) {
    if (hex8.test(t[i]!)) {
      n = i
      break
    }
  }
  const o = n === -1 ? undefined : t[n]
  const i = n === -1 ? t.length : n
  const s = t.slice(1, i)
  const a = s.length > 0 ? s.join(FORK_SESSION_TOAST_SEP) : undefined
  const l = n === -1 ? [] : t.slice(n + 1)
  return { state: r, name: a, id: o, chips: l }
}

/**
 * densable 2.1.216 L2p toast after successful keepParent fork — **one line**:
 *   session running|waiting… · <name> · <8-hex attach id> · [shared-checkout chip]
 *
 * Official: name + claude-attach id + note when copy shares checkout.
 * densable chips: relocated → "runs in the origin tree"; this-tree → "edits this checkout".
 * Multi-line 212 prose (permission inherit, attach how-to) is intentionally dropped.
 */
export function formatForkSessionToast(opts: {
  name: string
  short: string
  hadPrompt: boolean
  editsIn?: 'this-tree' | 'own-worktree'
  relocatedTo?: string
  /** densable toast no longer includes permission inherit; kept for call-site compat. */
  permissionMode?: string
}): string {
  void opts.permissionMode
  const state = opts.hadPrompt
    ? FORK_SESSION_STATE_RUNNING
    : FORK_SESSION_STATE_WAITING_PROMPT
  const name = opts.name ? collapseForkPromptLabel(opts.name, 40) : undefined
  // densable id = bfe.short (8-hex attach id used with `claude attach`)
  const id = opts.short
  let chip: string | undefined
  if (opts.relocatedTo) {
    chip = FORK_SESSION_CHIP_RUNS_ORIGIN
  } else if (opts.editsIn === 'this-tree') {
    chip = FORK_SESSION_CHIP_EDITS_THIS_CHECKOUT
  }
  // own-worktree: densable leaves chip void (no shared-checkout note)
  return formatSessionStatusLine({
    state,
    name,
    id,
    chips: chip ? [chip] : [],
  })
}

/**
 * densable editsIn when keepParent and not relocated:
 *   dme(cwd) || settings.worktree.bgIsolation==="none" → this-tree
 *   else → own-worktree
 */
export function resolveForkEditsIn(opts: {
  inWorktree: boolean
  bgIsolationNone?: boolean
  /** densable: if not a git repo (wu===null) → undefined */
  isGitRepo?: boolean
}): 'this-tree' | 'own-worktree' | undefined {
  if (opts.isGitRepo === false) return undefined
  if (opts.bgIsolationNone || !opts.inWorktree) return 'this-tree'
  return 'own-worktree'
}

async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  // densable/leftArrow: unref timeout so a slow flush cannot pin the event loop.
  // DOM+Node lib union makes setTimeout return number | Timeout.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let timer: any
  try {
    return await Promise.race([
      p,
      new Promise<undefined>(resolve => {
        timer = setTimeout(resolve, ms)
        if (timer && typeof timer.unref === 'function') timer.unref()
      }),
    ])
  } catch {
    return undefined
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export type KeepParentForkSpawnOpts = {
  prompt?: string
  source?: string
  cwd?: string
  /** densable seed from M9e — intent/name/detail/color */
  seed?: BackgroundSeed
  permissionMode?: string
  /** densable effort wire value (number or label). */
  effortValue?: string | number
  /** Session additional working directories → --add-dir */
  additionalWorkingDirectories?: string[]
  sessionPermissionRules?: { allow: string[]; deny: string[] }
  memoryToggledOff?: boolean
  forkBoundaryAt?: string
  lastMessageUuid?: string | null
  /**
   * densable settings.worktree.bgIsolation === "none" → editsIn this-tree.
   */
  bgIsolationNone?: boolean
}

export async function spawnBackgroundSessionFork(
  opts: KeepParentForkSpawnOpts = {},
): Promise<SpawnBackgroundSessionForkResult> {
  if (feature('BG_SESSIONS')) {
    return spawnBackgroundSessionForkImpl(opts)
  }
  return {
    ok: false,
    error: 'Background sessions are not available in this build (BG_SESSIONS).',
    reason: 'bg_sessions_disabled',
  }
}

async function spawnBackgroundSessionForkImpl(
  opts: KeepParentForkSpawnOpts,
): Promise<SpawnBackgroundSessionForkResult> {
  // densable: if (c?.keepParent && fb()) return coordinator error
  if (isCoordinatorMode()) {
    return {
      ok: false,
      error:
        'Forking is not available in coordinator sessions. Use /branch instead.',
      reason: 'coordinator_mode',
    }
  }

  const parentSessionId = getSessionId()
  if (!parentSessionId) {
    return {
      ok: false,
      error: FORK_NOTHING_YET_ERROR,
      reason: 'no_session',
    }
  }

  const prompt = (opts.prompt ?? '').trim()
  const hadPrompt = prompt.length > 0
  const seed = opts.seed
  const { name, nameSource } = resolveKeepParentForkName({
    seedName:
      seed?.name ?? getCurrentSessionTitle(parentSessionId) ?? undefined,
    seedNameSource: seed?.nameSource,
    prompt,
  })
  // densable intent: seed.intent (from M9e) — prompt or last user or "(forked)"
  const intent = (seed?.intent ?? (prompt || '(forked)')).slice(0, 200)
  const providedSessionId = randomUUID() as UUID
  const short = providedSessionId.slice(0, 8)

  // densable keepParent worktree relocate:
  //   I = wt ? { to: originalCwd, from: entered|owned } : launched? …
  //   child cwd = I.to ?? wtPath ?? an()
  //   x = !keepParent && created → never for /fork
  const wt = getCurrentWorktreeSession()
  const inWorktree = Boolean(wt)
  let childCwd = opts.cwd ?? wt?.worktreePath ?? getOriginalCwd()
  let relocatedTo: string | undefined
  let relocatedFrom: 'entered' | 'owned' | 'launched' | undefined
  if (wt) {
    // densable: enteredExisting → "entered"; owned create → "owned"
    // Local: creationDurationMs set only on create.
    relocatedFrom = wt.creationDurationMs === undefined ? 'entered' : 'owned'
    relocatedTo = wt.originalCwd
    childCwd = wt.originalCwd
  }

  // densable: wu(an())===null → editsIn undefined (non-git)
  // editsIn only when NOT relocated (densable: R===undefined)
  const isGitRepo = findGitRoot(childCwd) !== null
  const editsIn = relocatedTo
    ? undefined
    : resolveForkEditsIn({
        inWorktree,
        bgIsolationNone: opts.bgIsolationNone,
        isGitRepo,
      })

  // densable memoryToggledOff: _U()||void 0
  const memoryToggledOff =
    opts.memoryToggledOff ?? (!isAutoMemoryEnabled() ? true : undefined)

  // densable: if (c?.keepParent) await D6e(lastUuid); await wa(flush, 10s)
  try {
    // densable D6e(l.at(-1)?.uuid ?? null) — last-prompt leaf boundary
    await recordForkBoundaryLeaf(opts.lastMessageUuid ?? null).catch(() => {
      /* best-effort like densable we() on non-keepParent paths; keepParent still flushes */
    })
    const flushed = await withTimeout(
      flushSessionStorage(),
      KEEP_PARENT_FLUSH_CAP_MS,
    )
    if (flushed === undefined) {
      return {
        ok: false,
        error:
          "Couldn't fork — this conversation is still being saved. Try again in a moment.",
        reason: 'flush_incomplete',
      }
    }
  } catch {
    return {
      ok: false,
      error:
        "Couldn't fork — this conversation is still being saved. Try again in a moment.",
      reason: 'flush_incomplete',
    }
  }

  // densable snapshot: parent transcript → jobDir/tmp/parent-transcript.jsonl
  const { getJobDirPath, writeA8qJobState } = await import(
    '../daemon/jobState.js'
  )
  const jobDir = getJobDirPath(short)
  const snapshotPath = join(jobDir, 'tmp', 'parent-transcript.jsonl')
  let resumeTarget: string = parentSessionId
  try {
    const parentTranscript = getTranscriptPath()
    await mkdir(dirname(snapshotPath), { recursive: true, mode: 0o700 })
    await copyFile(parentTranscript, snapshotPath)
    resumeTarget = snapshotPath
  } catch (err) {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {})
    return {
      ok: false,
      error: `Couldn't fork — ${errorMessage(err)}`,
      reason: 'snapshot_copy_failed',
    }
  }

  // densable: forkSourceAlive only when last message has timestamp
  const hasBoundaryTs =
    typeof opts.forkBoundaryAt === 'string' && opts.forkBoundaryAt.length > 0
  const forkBoundaryAt = hasBoundaryTs ? opts.forkBoundaryAt : undefined

  try {
    writeA8qJobState({
      sessionId: providedSessionId,
      cwd: childCwd,
      intent,
      name,
      nameSource,
      detail: seed?.detail,
      color: seed?.color,
      // Keep parent UUID for live-parent bookkeeping; launch uses snapshot path.
      resumeSessionId: parentSessionId,
      bgIsolation: 'default',
      sessionPermissionRules: opts.sessionPermissionRules,
      memoryToggledOff,
      forkSourceAlive: true,
      forkBoundaryAt: forkBoundaryAt ?? new Date().toISOString(),
      forkSessionId: providedSessionId,
      forkParentSessionId: parentSessionId,
    })
  } catch (err) {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {})
    return {
      ok: false,
      error: `Couldn't fork — ${errorMessage(err)}`,
      reason: 'job_state_write_failed',
    }
  }

  // densable pqb: carry task list (best-effort)
  try {
    const { carryTaskListToFork } = await import('../cli/bg/leftArrowAgents.js')
    await carryTaskListToFork(providedSessionId, parentSessionId)
  } catch {
    /* best-effort */
  }

  // densable CLI argv for keepParent child:
  //   j=[...resume/fork-session, ...gXe(), ...add-dir, tools, model, effort,
  //       "--permission-mode", n, ...kei agent/agents/append, ...prompt]
  const extraArgs: string[] = []

  // densable gXe() — launch REPL config argv (settings/plugin/add-dir/mcp/…)
  for (const arg of getReplConfigArgv()) {
    if (arg) extraArgs.push(arg)
  }

  // --add-dir for session additional working directories
  for (const dir of opts.additionalWorkingDirectories ?? []) {
    if (dir) extraArgs.push('--add-dir', dir)
  }

  // --allowed-tools / --disallowed-tools from session rules
  for (const t of opts.sessionPermissionRules?.allow ?? []) {
    if (t) extraArgs.push('--allowed-tools', t)
  }
  for (const t of opts.sessionPermissionRules?.deny ?? []) {
    if (t) extraArgs.push('--disallowed-tools', t)
  }

  // --model
  try {
    const model = getMainLoopModel()
    if (model) extraArgs.push('--model', String(model))
  } catch {
    /* optional */
  }

  // --effort
  if (opts.effortValue !== undefined && opts.effortValue !== null) {
    extraArgs.push('--effort', String(opts.effortValue))
  }

  // densable always passes "--permission-mode", n (even when default)
  extraArgs.push(
    '--permission-mode',
    opts.permissionMode && opts.permissionMode.length > 0
      ? opts.permissionMode
      : 'default',
  )

  // densable 2.1.221 isolation append-system-prompt (Lre = EnterWorktree):
  // - keepParent && relocated (R): forked-out-of linked worktree guidance
  // - keepParent && editsIn==="own-worktree": create own worktree guidance
  // - this-tree / non-git: no isolation append
  let isolationPrompt: string | undefined
  if (relocatedTo && wt) {
    const branchNote = wt.worktreeBranch ? ` (branch ${wt.worktreeBranch})` : ''
    const ownBranchClause = wt.worktreeBranch
      ? `, and if the task builds on the original's work, base your new branch on ${wt.worktreeBranch} rather than checking that branch out (it stays checked out in the original's worktree)`
      : ''
    isolationPrompt =
      `This conversation was forked out of ${wt.worktreePath}${branchNote}, a linked worktree the original session is still working in — never edit files, run commands, or enter that worktree with EnterWorktree. ` +
      `You are in ${relocatedTo}; before making code changes, create a new worktree of your own with EnterWorktree instead of reusing the original's${ownBranchClause}.`
  } else if (editsIn === 'own-worktree') {
    isolationPrompt =
      `This conversation was forked from a session that is still working in this checkout (${childCwd}). ` +
      `Before making code changes, create a new worktree of your own with EnterWorktree so your edits don't land where the original session is editing.`
  }

  // densable kei() merge: keepParent?kei():{} → --agent / --agents /
  // --append-system-prompt (kei append + isolation, joined with two spaces)
  const replay = mergeForkReplayIntoChildArgs({
    replay: getForkReplayLaunchConfig(),
    isolationAppend: isolationPrompt,
  })
  if (replay.agent) {
    extraArgs.push('--agent', replay.agent)
  }
  if (replay.agents) {
    extraArgs.push('--agents', replay.agents)
  }
  if (replay.appendSystemPrompt) {
    extraArgs.push('--append-system-prompt', replay.appendSystemPrompt)
  }

  // densable: ...t?["--", t]:[]
  if (prompt) {
    extraArgs.push('--', prompt)
  }

  const { ensureDaemonRunning } = await import('../daemon/installPrompt.js')
  const daemon = await ensureDaemonRunning({
    forceTransient: true,
    mayPromptInstall: false,
  })
  if (!daemon.ok) {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {})
    return {
      ok: false,
      error: `Failed to start background session: ${daemon.reason ?? 'daemon unavailable'}`,
      reason: 'daemon_unavailable',
    }
  }

  try {
    const { submitDispatch } = await import('../daemon/bgManager.js')
    const dispatch = await submitDispatch({
      intent,
      name,
      cwd: childCwd,
      source: opts.source ?? 'fork_session',
      // densable --resume <snapshotPath> --fork-session --session-id NEW
      resumeSessionId: resumeTarget,
      forkSession: true,
      providedSessionId,
      extraArgs: extraArgs.length > 0 ? extraArgs : undefined,
      sessionPermissionRules: opts.sessionPermissionRules,
      memoryToggledOff,
    })
    return {
      ok: true,
      short: dispatch.short,
      sessionId: dispatch.sessionId,
      name,
      editsIn,
      relocatedTo,
      relocatedFrom,
      hadWorktree: inWorktree,
      hadPrompt,
    }
  } catch (err) {
    const alreadyAlive =
      typeof err === 'object' &&
      err !== null &&
      'alive' in err &&
      (err as { alive?: unknown }).alive === true
    if (alreadyAlive) {
      return {
        ok: true,
        short,
        sessionId: providedSessionId,
        name,
        editsIn,
        relocatedTo,
        relocatedFrom,
        hadWorktree: inWorktree,
        hadPrompt,
      }
    }
    await rm(jobDir, { recursive: true, force: true }).catch(() => {})
    const message = errorMessage(err)
    logForDebugging(`spawnBackgroundSessionFork dispatch failed: ${message}`, {
      level: 'error',
    })
    return {
      ok: false,
      error: `Couldn't fork — ${message}`,
      reason: 'spawn_failed',
    }
  }
}

/** True when resume target is a filesystem path (densable snapshot resume). */
export function isResumeTranscriptPath(target: string): boolean {
  return (
    isAbsolute(target) ||
    target.endsWith('.jsonl') ||
    target.endsWith('.json') ||
    target.includes('/') ||
    target.includes('\\')
  )
}
