import chalk from 'chalk'
import { writeSync } from 'fs'
import memoize from 'lodash-es/memoize.js'
import { onExit } from 'signal-exit'
import type { ExitReason } from 'src/entrypoints/agentSdkTypes.js'
import {
  getIsInteractive,
  getIsNonInteractiveSession,
  getIsScrollDraining,
  getLastMainRequestId,
  getSessionId,
  isSessionPersistenceDisabled,
} from '../bootstrap/state.js'
import {
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
  DBP,
  DFE,
  DISABLE_MOUSE_TRACKING,
  exitAltScreenSequence,
  SHOW_CURSOR,
  CLEAR_ITERM2_PROGRESS,
  CLEAR_TAB_STATUS,
  clearTerminalTitle,
  Ns,
  RESET_SCROLL_REGION,
  flushNonBlockingStdout,
  printsUnknownSequences,
  supportsTabStatus,
  wrapForMultiplexer,
} from '@anthropic/ink'
import { shutdownDatadog } from '../services/analytics/datadog.js'
import { shutdown1PEventLogging } from '../services/analytics/firstPartyEventLogger.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type { AppState } from '../state/AppState.js'
import {
  CLEANUP_DRAIN_TIMEOUT_MS,
  runCleanupFunctions,
} from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { isEnvTruthy } from './envUtils.js'
import {
  drainStdoutBeforeExit,
  getStdoutDrainBudgetMs,
  markStdoutDrainExternallyClocked,
} from './process.js'
import { sessionIdExists } from './sessionStorage.js'
import {
  getBootstrapSession,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from './sessionHost.js'
import { sleep } from './sleep.js'
import { closeSentry } from './sentry.js'
import { emitScrollTelemetrySummary } from './scrollTelemetry.js'
import { profileReport } from './startupProfiler.js'
import {
  formatWorktreeCommitDescription,
  getCurrentWorktreeSession,
  inspectWorktreeHeadState,
  type WorktreeHeadState,
} from './worktree.js'
import {
  markShutdownCommitted,
  resetShutdownCommittedForTests,
} from './shutdownCommitted.js'
import {
  beginOAuthRefreshLockHold,
  getHeldOAuthRefreshPromise as getAuthHeldOAuthRefreshPromise,
  resetOAuthRefreshHoldForTesting,
  waitForHeldOAuthRefresh as waitForAuthHeldOAuthRefresh,
} from './auth.js'

/** densable `tlr` — G0 USASCII + SI. */
const G0_USASCII = '\x1b(B\x0f'
/** densable `$7t` — disable DEC 2031 theme reports (`CSI ? 2031 l`). */
const DISABLE_THEME_REPORTS = '\x1b[?2031l'
/** densable `x` — reset OSC 111/110 surface bg/fg colors. */
const RESET_SURFACE_COLORS = '\x1b]111\x07\x1b]110\x07'

/**
 * Clean up terminal modes synchronously before process exit.
 * This ensures terminal escape sequences (Kitty keyboard, focus reporting, etc.)
 * are properly disabled even if React's componentWillUnmount doesn't run in time.
 * Uses writeSync to ensure writes complete before exit.
 *
 * We unconditionally send all disable sequences because:
 * 1. Terminal detection may not always work correctly (e.g., in tmux, screen)
 * 2. These sequences are no-ops on terminals that don't support them
 * 3. Failing to disable leaves the terminal in a broken state
 */
/* eslint-disable custom-rules/no-sync-fs -- must be sync to flush before process.exit */
/** Official Nj — Dcn()?.cleanupTerminalModes() on leftover `_G`. */
export function cleanupTerminalModes(): void {
  if (!process.stdout.isTTY) {
    return
  }

  try {
    const registry = Ns()
    const inst = registry.get(process.stdout)
    // Official 2.1.327 (#448/#449) b2: flush queued non-blocking stdout writes
    // and retain the instance reference so forceExit can still drainStdin even
    // after detachForShutdown/unmount (e.g. Ctrl+C right after ← handoff or trust).
    flushNonBlockingStdout()
    registry.restoredAtExit = inst ?? registry.restoredAtExit
    // Disable mouse tracking FIRST, before the React unmount tree-walk.
    // The terminal needs a round-trip to process this and stop sending
    // events; doing it now (not after unmount) gives that time while
    // we're busy unmounting. Otherwise events arrive during cooked-mode
    // cleanup and either echo to the screen or leak to the shell.
    writeSync(
      1,
      (inst?.modes.reset('mousePixels') ?? '') + DISABLE_MOUSE_TRACKING,
    )
    inst?.modes.reset('mouse')
    // Exit alt screen FIRST so printResumeHint() (and all sequences below)
    // land on the main buffer.
    //
    // Unmount Ink directly rather than writing EXIT_ALT_SCREEN ourselves.
    // Ink registered its unmount with signal-exit, so it will otherwise run
    // AGAIN inside forceExit() → process.exit(). Two problems with letting
    // that happen:
    //   1. If we write 1049l here and unmount writes it again later, the
    //      second one triggers another DECRC — the cursor jumps back over
    //      the resume hint and the shell prompt lands on the wrong line.
    //   2. unmount()'s onRender() must run with altScreenActive=true (alt-
    //      screen cursor math) AND on the alt buffer. Exiting alt-screen
    //      here first makes onRender() scribble a REPL frame onto main.
    // Calling unmount() now does the final render on the alt buffer,
    // unsubscribes from signal-exit, and writes 1049l exactly once.
    let exitedAltScreenViaUnmount = false
    if (inst?.isAltScreenActive) {
      try {
        inst.unmount()
        exitedAltScreenViaUnmount = true
      } catch {
        writeSync(1, exitAltScreenSequence())
        exitedAltScreenViaUnmount = true
      }
    }
    // Catches events that arrived during the unmount tree-walk.
    // detachForShutdown() below also drains.
    inst?.drainStdin()
    // Mark the Ink instance unmounted so signal-exit's deferred ink.unmount()
    // early-returns instead of sending redundant EXIT_ALT_SCREEN sequences
    // (from its writeSync cleanup block + AlternateScreen's unmount cleanup).
    // Those redundant sequences land AFTER printResumeHint() and clobber the
    // resume hint on tmux (and possibly other terminals) by restoring the
    // saved cursor position. Safe to skip full unmount: this function already
    // sends all the terminal-reset sequences, and the process is exiting.
    inst?.detachForShutdown()
    // Reset any remaining active terminal modes (e.g. surface OSC 110/111,
    // themeReports, bracketedPaste, focusEvents) and G0 USASCII charset.
    const modesReset = inst?.modes.resetAll() ?? ''
    if (modesReset) {
      writeSync(1, modesReset)
    }
    // Official 2.1.327 (#448/#449) Ec: unconditionally emit EXIT_ALT_SCREEN
    // when neither unmount nor modesReset emitted it (and terminal does not
    // print unknown sequences literally). Covers Ctrl+C during alt-screen
    // handoff (← agents view) or right after the trust dialog before REPL mounts.
    const exitAlt = exitAltScreenSequence()
    if (
      !exitedAltScreenViaUnmount &&
      !modesReset.includes(exitAlt) &&
      !printsUnknownSequences()
    ) {
      writeSync(1, exitAlt)
    }
    writeSync(1, G0_USASCII)
    if (!modesReset.includes(RESET_SURFACE_COLORS)) {
      writeSync(1, RESET_SURFACE_COLORS)
    }
    // Disable extended key reporting — always send both since terminals
    // silently ignore whichever they don't implement
    writeSync(1, DISABLE_MODIFY_OTHER_KEYS)
    writeSync(1, DISABLE_KITTY_KEYBOARD)
    // Disable focus events (DECSET 1004)
    writeSync(1, DFE)
    // Disable theme reports (DECSET 2031)
    writeSync(1, DISABLE_THEME_REPORTS)
    // Disable bracketed paste mode
    writeSync(1, DBP)
    // Show cursor
    writeSync(1, SHOW_CURSOR)
    // Reset scroll region with DECSC/DECRC so cursor position is preserved
    writeSync(1, '\x1b7' + RESET_SCROLL_REGION + '\x1b8')
    // Clear iTerm2 progress bar - prevents lingering progress indicator
    // that can cause bell sounds when returning to the terminal tab
    writeSync(1, CLEAR_ITERM2_PROGRESS)
    // Clear tab status (OSC 21337) so a stale dot doesn't linger
    if (supportsTabStatus()) writeSync(1, wrapForMultiplexer(CLEAR_TAB_STATUS))
    // Clear terminal title so the tab doesn't show stale session info.
    // Respect CLAUDE_CODE_DISABLE_TERMINAL_TITLE — if the user opted out of
    // title changes, don't clear their existing title on exit either.
    let terminalTitleDisabled = isEnvTruthy(
      process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE,
    )
    try {
      const { isTerminalTitleDisabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
      terminalTitleDisabled = isTerminalTitleDisabled()
    } catch {
      // residual helpers optional
    }
    if (!terminalTitleDisabled) {
      // densable: win32 process.title=''; elsewhere CLEAR_TERMINAL_TITLE (OSC 0).
      clearTerminalTitle(data => {
        writeSync(1, data)
      })
    }
  } catch {
    // Terminal may already be gone (e.g., SIGHUP after terminal close).
    // Ignore write errors since we're exiting anyway.
  }
}

type OwedSandboxCleanupEntry = {
  promise: Promise<void>
  resolve: () => void
}

/**
 * Official 2.1.331 [W-259] — host-scoped shutdown state isolated via HostSlot
 * on SessionHost. Live instances are tracked via WeakRef so process-level
 * SIGTERM / gracefulShutdown can still abort/drain all live hosts on exit.
 */
type GracefulShutdownHostState = {
  resumeHintPrinted: boolean
  resumeHintOmitsWorktree: boolean
  resumeHintLaunchFlags: string | undefined
  interactiveShutdownAbort: (() => void) | null
  owedSandboxCleanups: Map<unknown, OwedSandboxCleanupEntry>
}

const shutdownHostStateRefs = new Set<WeakRef<GracefulShutdownHostState>>()

const gracefulShutdownHostSlot = new HostSlot<GracefulShutdownHostState>(() => {
  const state: GracefulShutdownHostState = {
    resumeHintPrinted: false,
    resumeHintOmitsWorktree: false,
    resumeHintLaunchFlags: undefined,
    interactiveShutdownAbort: null,
    owedSandboxCleanups: new Map(),
  }
  for (const ref of shutdownHostStateRefs) {
    if (ref.deref() === undefined) {
      shutdownHostStateRefs.delete(ref)
    }
  }
  shutdownHostStateRefs.add(new WeakRef(state))
  return state
})

function getShutdownHostState(): GracefulShutdownHostState {
  return gracefulShutdownHostSlot.of(getBootstrapSessionHost())
}

export function setResumeHintLaunchFlags(flags: string | undefined): void {
  getShutdownHostState().resumeHintLaunchFlags = flags
}

export function getResumeHintLaunchFlags(): string | undefined {
  return getShutdownHostState().resumeHintLaunchFlags
}

const RESUME_HINT_IGNORED_OPTIONS = new Set([
  'resume',
  'continue',
  'from-pr',
  'fork-session',
  'session-id',
  'name',
  'teleport',
  'cloud',
  'remote',
  'desktop',
  'environment',
  'pool',
  'project',
  'ref',
  'on-branch',
  'correlation-id',
  'forward-home-settings',
  'resume-session-at',
  'resume-drops-turn',
  'reply-on-resume',
  'rewind-files',
  'worktree',
  'tmux',
  'background',
  'routine',
  'file',
  'init',
  'init-only',
  'maintenance',
  'prefill',
  'prefill-b64',
  'deep-link-origin',
  'deep-link-repo',
  'deep-link-last-fetch',
  'deep-link-cwd-b64',
  'watch-artifact',
  'watch-artifact-no-autoreact',
])

const RESUME_HINT_DISALLOWED_OPTIONS = new Set([
  'agent-id',
  'agent-name',
  'team-name',
  'agent-color',
  'agent-type',
  'parent-session-id',
  'lead-verify-key',
  'plan-mode-required',
  'inherit-permission-mode',
  'agents-view-if-allowed',
  'attach-serve',
  'session-began-as-copy',
  'messaging-socket-path',
  'project-config-root',
])

const SAFE_FLAG_RE = /^-[\w/:@=+-]*$/
const SAFE_ARG_RE = /^[\w./:+][\w./:@=+-]*$/
const UNSAFE_DEVICE_PATH_RE = /(^|=)\/(dev|proc)\//

export type CommanderOptionLike = {
  short?: string
  long?: string
  required?: boolean
  optional?: boolean
  variadic?: boolean
  name(): string
}

/**
 * Official `Hds` (#1587) — extract safe, replayable launch flags from argv
 * for the exit resume hint (`Resume this session with: claude <flags> --resume <id>`).
 */
export function extractResumeHintLaunchFlags(
  options: readonly CommanderOptionLike[],
  argv: readonly string[],
): string {
  const out: string[] = []
  let i = 0
  const findOpt = (flag: string) =>
    options.find(o => o.short === flag || o.long === flag)

  while (i < argv.length) {
    const token = argv[i++]!
    if (token === '--') break
    if (!token.startsWith('-')) continue
    const args: string[] = []
    let opt = findOpt(token)
    if (opt) {
      if (opt.required) {
        if (i >= argv.length) return ''
        args.push(argv[i++]!)
      } else if (opt.optional && i < argv.length && !argv[i]!.startsWith('-')) {
        args.push(argv[i++]!)
      }
      if (opt.variadic) {
        while (i < argv.length && !argv[i]!.startsWith('-')) {
          args.push(argv[i++]!)
        }
      }
    } else {
      const eqIdx = token.startsWith('--') ? token.indexOf('=') : -1
      opt = eqIdx > 2 ? findOpt(token.slice(0, eqIdx)) : undefined
      if (!opt || !(opt.required || opt.optional)) return ''
    }
    const name = opt.name()
    if (RESUME_HINT_DISALLOWED_OPTIONS.has(name)) return ''
    if (RESUME_HINT_IGNORED_OPTIONS.has(name)) continue
    if (
      !SAFE_FLAG_RE.test(token) ||
      !args.every(a => SAFE_ARG_RE.test(a)) ||
      [token, ...args].some(a => UNSAFE_DEVICE_PATH_RE.test(a))
    ) {
      return ''
    }
    out.push(token, ...args)
  }
  return out.join(' ')
}

/**
 * Official `nLi` (#1587) — consume `CLAUDE_CODE_RELAUNCH_RESUME_HINT_FLAGS`
 * across `/tui` relaunch if valid.
 */
export function consumeRelaunchResumeHintFlags(
  options: readonly CommanderOptionLike[],
): string | undefined {
  const raw = process.env.CLAUDE_CODE_RELAUNCH_RESUME_HINT_FLAGS
  if (raw === undefined) return undefined
  delete process.env.CLAUDE_CODE_RELAUNCH_RESUME_HINT_FLAGS
  return extractResumeHintLaunchFlags(options, raw.split(' ')) === raw
    ? raw
    : ''
}

const WORKTREE_RESUME_ADVICE = [
  'This session ran in a worktree',
  'In its folder, run the command below to resume in it',
  'To find that folder, try git worktree list',
]

const LAUNCHER_PROGRAM_RE = /^\w[\w-]*$/

function isSafeWorktreeName(name: string): boolean {
  if (name.length === 0 || name.startsWith('-')) return false
  // Reject quotes, backticks, $, newlines, control chars
  return !/[\r\n\0"'`$\\]/.test(name)
}

export type FormatResumeHintInput = {
  sessionId: string
  worktree?: {
    name: string
    recordCleared: boolean
  }
  columns?: number
  envAssignment?: string
  launchFlags?: string
  launcherProgram?: string
}

export type FormatResumeHintResult = {
  advice: string[]
  command: string
  arg: 'id' | 'none'
  flags: boolean
  launcher: boolean
  worktree:
    | 'absent'
    | 'printed'
    | 'printed_short_flags'
    | 'refused'
    | 'too_wide'
    | 'width_unknown'
}

/**
 * SEA `wHa` (#728 & #729):
 * - Always names the session by ID, never by custom title (#728).
 * - For worktrees, degrades `--worktree "<name>" --resume <id>` to
 *   `-w "<name>" -r <id>` if long flags don't fit `columns`, and prints
 *   directory advice above if neither fits a kept worktree (#729).
 */
export function formatResumeHint({
  sessionId,
  worktree,
  columns,
  envAssignment,
  launchFlags = '',
  launcherProgram,
}: FormatResumeHintInput): FormatResumeHintResult {
  const base =
    envAssignment === undefined ? 'claude' : `${envAssignment} claude`
  const idPart = sessionId ? ` ${sessionId}` : ''
  const arg: 'id' | 'none' = sessionId ? 'id' : 'none'

  if (
    launcherProgram !== undefined &&
    LAUNCHER_PROGRAM_RE.test(launcherProgram)
  ) {
    return {
      advice: [],
      command: `${launcherProgram} --resume${idPart}`,
      arg,
      flags: false,
      launcher: true,
      worktree: worktree === undefined ? 'absent' : 'refused',
    }
  }

  const validColumns =
    typeof columns === 'number' && Number.isFinite(columns) && columns > 0
      ? Math.floor(columns)
      : undefined
  const includeFlags =
    launchFlags !== '' &&
    (!/[/.]/.test(launchFlags) ||
      (validColumns !== undefined &&
        `${base} ${launchFlags} --resume${idPart}`.length <= validColumns))
  const cmdBase = includeFlags ? `${base} ${launchFlags}` : base

  if (worktree === undefined) {
    return {
      advice: [],
      command: `${cmdBase} --resume${idPart}`,
      arg,
      flags: includeFlags,
      launcher: false,
      worktree: 'absent',
    }
  }

  const { name, recordCleared } = worktree
  const candidates: Array<{
    command: string
    worktree: 'printed' | 'printed_short_flags'
  }> =
    typeof name === 'string' && isSafeWorktreeName(name)
      ? [
          {
            command: `${cmdBase} --worktree "${name}" --resume${idPart}`,
            worktree: 'printed',
          },
          {
            command: `${cmdBase} -w "${name}" -r${idPart}`,
            worktree: 'printed_short_flags',
          },
        ]
      : []

  const fitting = candidates.find(
    c => validColumns !== undefined && c.command.length <= validColumns,
  )
  if (fitting !== undefined) {
    return {
      advice: [],
      arg,
      flags: includeFlags,
      launcher: false,
      ...fitting,
    }
  }

  return {
    advice: recordCleared ? WORKTREE_RESUME_ADVICE : [],
    command: `${cmdBase} --resume${idPart}`,
    arg,
    flags: includeFlags,
    launcher: false,
    worktree:
      candidates.length === 0
        ? 'refused'
        : validColumns !== undefined
          ? 'too_wide'
          : 'width_unknown',
  }
}

/**
 * Print a hint about how to resume the session.
 * Only shown for interactive sessions with persistence enabled.
 */
function printResumeHint(): void {
  const hostState = getShutdownHostState()
  // Only print once (failsafe timer may call this again after normal shutdown)
  if (hostState.resumeHintPrinted) {
    return
  }
  // Only show with TTY, interactive sessions, and persistence
  if (
    process.stdout.isTTY &&
    getIsInteractive() &&
    !isSessionPersistenceDisabled()
  ) {
    try {
      const sessionId = getSessionId()
      // Don't show resume hint if no session file exists (e.g., subcommands like `claude update`)
      if (!sessionIdExists(sessionId)) {
        return
      }

      const worktreeSession = hostState.resumeHintOmitsWorktree
        ? undefined
        : getCurrentWorktreeSession()
      const worktreeName =
        worktreeSession && !worktreeSession.enteredExisting
          ? worktreeSession.worktreeName
          : undefined

      const { advice, command } = formatResumeHint({
        sessionId,
        worktree: worktreeName
          ? { name: worktreeName, recordCleared: true }
          : undefined,
        columns: process.stdout.columns,
        launchFlags: hostState.resumeHintLaunchFlags,
        launcherProgram: process.env.CLAUDE_CODE_RESUME_HINT_COMMAND,
      })

      writeSync(
        1,
        chalk.dim(
          ['', ...advice, 'Resume this session with:', command, ''].join('\n'),
        ),
      )
      hostState.resumeHintPrinted = true
    } catch {
      // Ignore write errors
    }
  }
}
/* eslint-enable custom-rules/no-sync-fs */

/**
 * Force process exit, handling the case where the terminal is gone.
 * When the terminal/PTY is closed (e.g., SIGHUP), process.exit() can throw
 * EIO errors because Bun tries to flush stdout to a dead file descriptor.
 * In that case, fall back to SIGKILL which always works.
 */
function forceExit(exitCode: number): never {
  // Clear failsafe timer since we're exiting now
  if (failsafeTimer !== undefined) {
    clearTimeout(failsafeTimer)
    failsafeTimer = undefined
  }
  // Drain stdin LAST, right before exit. cleanupTerminalModes() sent
  // DISABLE_MOUSE_TRACKING early, but the terminal round-trip plus any
  // events already in flight means bytes can arrive during the seconds
  // of async cleanup between then and now. Draining here catches them.
  // Use the Ink class method (not the standalone drainStdin()) so we
  // drain the instance's stdin — when process.stdin is piped,
  // getStdinOverride() opens /dev/tty as the real input stream and the
  // class method knows about it; the standalone function defaults to
  // process.stdin which would early-return on isTTY=false.
  try {
    const registry = Ns()
    ;(registry.get(process.stdout) ?? registry.restoredAtExit)?.drainStdin()
  } catch {
    // Terminal may be gone (SIGHUP). Ignore — we are about to exit.
  }
  try {
    process.exit(exitCode)
  } catch (e) {
    // process.exit() threw. In tests, it's mocked to throw - re-throw so test sees it.
    // In production, it's likely EIO from dead terminal - use SIGKILL.
    if ((process.env.NODE_ENV as string) === 'test') {
      throw e
    }
    // Fall back to SIGKILL which doesn't try to flush anything.
    // Official 2.1.327 (#411): Linux LSM/seccomp may block self-signalling with
    // EPERM; fall back to process.exitCode rather than crashing with EPERM.
    try {
      process.kill(process.pid, 'SIGKILL')
    } catch {
      process.exitCode = exitCode
      return undefined as never
    }
  }
  // In tests, process.exit may be mocked to return instead of exiting.
  // In production, we should never reach here.
  if ((process.env.NODE_ENV as string) !== 'test') {
    throw new Error('unreachable')
  }
  // TypeScript trick: cast to never since we know this only happens in tests
  // where the mock returns instead of exiting
  return undefined as never
}

/**
 * Sync pre-shutdown: disable mouse tracking + drain stdin immediately on
 * SIGINT/SIGTERM/etc, before gracefulShutdown's first `await import`.
 *
 * Without this, mouse SGR bytes still arrive while hooks load and echo as
 * garbage like `move…` on the main buffer after alt-screen exit (common on
 * Windows Terminal with bun run dev + Ctrl+C).
 *
 * Full alt-screen unmount still happens in cleanupTerminalModes(); this is
 * the latency-sensitive half only.
 */
function preemptTerminalForShutdown(): void {
  if (!process.stdout.isTTY) {
    return
  }
  try {
    writeSync(1, DISABLE_MOUSE_TRACKING)
    Ns().get(process.stdout)?.drainStdin()
  } catch {
    // Terminal may already be gone.
  }
}

/**
 * Set up global signal handlers for graceful shutdown
 */
/**
 * densable `Vwo` / `uxs` — print/SDK `run()` has registered its own SIGINT +
 * SIGTERM handlers that abort the in-flight query (killing Bash process trees)
 * before exiting. Global handlers must no-op once this is set, or they race
 * and exit without aborting the turn / orphaning shell children.
 */
let printModeSignalHandlersRegistered = false

/** densable `uxs` — mark print/SDK signal handlers as owning SIGINT/SIGTERM. */
export function markPrintModeSignalHandlersRegistered(): void {
  printModeSignalHandlersRegistered = true
}

/** densable `Vwo` — true after print/SDK registered SIGINT+SIGTERM handlers. */
export function isPrintModeSignalHandlersRegistered(): boolean {
  return printModeSignalHandlersRegistered
}

/**
 * Interactive REPL: abort in-flight query with remote-cancel on SIGTERM
 * (print owns its own handlers via markPrintModeSignalHandlersRegistered).
 */
export function registerInteractiveShutdownAbort(
  fn: (() => void) | null,
): void {
  getShutdownHostState().interactiveShutdownAbort = fn
}

export function getInteractiveShutdownAbortForTests(): (() => void) | null {
  return getShutdownHostState().interactiveShutdownAbort
}

export const setupGracefulShutdown = memoize(() => {
  // Work around a Bun bug where process.removeListener(sig, fn) resets the
  // kernel sigaction for that signal even when other JS listeners remain —
  // the signal then falls back to its default action (terminate) and our
  // process.on('SIGTERM') handler never runs.
  //
  // Trigger: any short-lived signal-exit v4 subscriber (e.g. execa per child
  // process, or an Ink instance that unmounts). When its unsubscribe runs and
  // it was the last v4 subscriber, v4.unload() calls removeListener on every
  // signal in its list (SIGTERM, SIGINT, SIGHUP, …), tripping the Bun bug and
  // nuking our handlers at the kernel level.
  //
  // Fix: pin signal-exit v4 loaded by registering a no-op onExit callback that
  // is never unsubscribed. This keeps v4's internal emitter count > 0 so
  // unload() never runs and removeListener is never called. Harmless under
  // Node.js — the pin also ensures signal-exit's process.exit hook stays
  // active for Ink cleanup.
  onExit(() => {})

  // Capture ppid at setup for densable SIGTERM diagnostics (ppid_changed).
  const setupPpid = process.ppid

  process.on('SIGINT', () => {
    // densable: if(Vwo)return — print/SDK owns SIGINT after uxs().
    // Fallback: argv -p/--print for paths that register SIGINT before uxs.
    if (
      printModeSignalHandlersRegistered ||
      process.argv.includes('-p') ||
      process.argv.includes('--print')
    ) {
      return
    }
    // Windows: stop mouse tracking + drain stdin BEFORE any async import in
    // gracefulShutdown. Otherwise leftover SGR mouse bytes print as garbage
    // ("move…") on the main buffer while hooks.js loads, and look like multi-window noise.
    preemptTerminalForShutdown()
    logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGINT' })
    void gracefulShutdown(0)
  })
  process.on('SIGTERM', () => {
    // densable SIGTERM diagnostics: uptime / ppid / stdin / tty.
    const termMeta = {
      uptime_s: Math.round(process.uptime()),
      ppid_changed: process.ppid !== setupPpid,
      stdin_at_eof: process.stdin.readableEnded,
      stdin_destroyed: process.stdin.destroyed,
      is_tty: process.stdin.isTTY ?? false,
    }
    logForDiagnosticsNoPII('info', 'shutdown_signal', {
      signal: 'SIGTERM',
      ...termMeta,
    })
    logEvent('tengu_shutdown_signal', {
      signal:
        'SIGTERM' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      uptime_s: termMeta.uptime_s,
      ppid_changed: termMeta.ppid_changed,
      stdin_at_eof: termMeta.stdin_at_eof,
      stdin_destroyed: termMeta.stdin_destroyed,
      is_tty: termMeta.is_tty,
    })
    // densable: if(Vwo)return — print/SDK handler aborts turn + Ts(143).
    if (printModeSignalHandlersRegistered) {
      return
    }
    // densable #27 interactive: abort in-flight query as remote-cancel
    // before exit so StreamingToolExecutor does not emit synthetic denials.
    for (const ref of shutdownHostStateRefs) {
      const hostState = ref.deref()
      if (hostState === undefined) {
        shutdownHostStateRefs.delete(ref)
        continue
      }
      try {
        hostState.interactiveShutdownAbort?.()
      } catch {
        // abort must not block shutdown
      }
    }
    preemptTerminalForShutdown()
    void gracefulShutdown(143) // Exit code 143 (128 + 15) for SIGTERM
  })
  process.on('SIGHUP', () => {
    handleSighupSignal()
  })
  if (process.platform === 'win32') {
    process.on('SIGBREAK', () => {
      preemptTerminalForShutdown()
      logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGBREAK' })
      void gracefulShutdown(0)
    })
  } else if (process.env.CLAUDE_BG_BACKEND !== 'daemon') {
    // Detect orphaned process when terminal closes without delivering SIGHUP.
    // macOS revokes TTY file descriptors instead of signaling, leaving the
    // process alive but unable to read/write. Periodically check stdin validity.
    // Skipped for daemon background workers (`CLAUDE_BG_BACKEND === 'daemon'`).
    if (process.stdin.isTTY) {
      orphanCheckInterval = setInterval(() => {
        // Skip during scroll drain — even a cheap check consumes an event
        // loop tick that scroll frames need. 30s interval → missing one is fine.
        if (getIsScrollDraining()) return
        // process.stdout.writable becomes false when the TTY is revoked
        if (!process.stdout.writable || !process.stdin.readable) {
          clearInterval(orphanCheckInterval)
          logForDiagnosticsNoPII('info', 'shutdown_signal', {
            signal: 'orphan_detected',
          })
          void gracefulShutdown(129)
        }
      }, 30_000) // Check every 30 seconds
      orphanCheckInterval.unref() // Don't keep process alive just for this check
    }
  }

  // Official 2.1.328 `dRa` (`chunk@294254613.js@380900..384500`):
  // uncaughtException / unhandledRejection with HTTP/2 stream-teardown recovery
  // budget, CLAUDE_CODE_SUPERVISED immediate exit, 10-in-5s loop circuit
  // breaker, and 10s startup-mount watchdog.
  process.on('uncaughtException', error => {
    handleUncaughtException(error)
  })

  process.on('unhandledRejection', reason => {
    handleUnhandledRejection(reason)
  })
})

/** Official 2.1.328 `dRa` (`chunk@294254613.js@377316..393500`) constants. */
export const UNCAUGHT_EXCEPTION_BREAKER_THRESHOLD = 10
export const UNCAUGHT_EXCEPTION_BREAKER_WINDOW_MS = 5_000
export const UNCAUGHT_RECENT_CAP = 3
export const HTTP2_RECOVERY_BUDGET = 50
export const HTTP2_RECOVERY_WINDOW_MS = 60_000
export const STARTUP_MOUNT_WATCHDOG_MS = 10_000
export const SANDBOX_CLEANUP_WAIT_MS = 500
export const WORKTREE_REMOVAL_DEFAULT_BUDGET_MS = 600_000
/** Official `Mon = 70` (`EX_SOFTWARE`) for uncaught errors under `CLAUDE_CODE_SUPERVISED`. */
export const SUPERVISED_UNCAUGHT_EXIT_CODE = 70

const HTTP2_STREAM_ERROR_RE =
  /^Stream closed with error code NGHTTP2_[A-Z0-9_]+$/
const HTTP2_SESSION_ERROR_RE = /^Session closed with error code \d+$/

let ownsControllingTerminal = false
let uncaughtCount = 0
let uncaughtWindowStart = 0
let uncaughtBreakerTripped = false
let recentUncaught: Array<{ name: string; message: string }> = []
let http2RecoveryCount = 0
let http2RecoveryWindowStart = 0
let startupActionStarted = false
let startupExpectsUiMount = false
let startupUiMounted = false
const startupWatchdogTimers = new Set<ReturnType<typeof setTimeout>>()

function hasStackFrame(stack: unknown, needle: string): boolean {
  return (
    typeof stack === 'string' &&
    stack.split('\n').some(line => {
      const trimmed = line.trim()
      return trimmed.startsWith('at ') && trimmed.includes(needle)
    })
  )
}

/**
 * Official 2.1.328 `cen(e)` (`chunk@294254613.js@349623`):
 * Detect recoverable Node/Bun HTTP/2 stream/session teardown errors.
 */
export function isHttp2StreamTeardownError(error: unknown): boolean {
  try {
    if (!(error instanceof Error)) return false
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ERR_HTTP2_STREAM_ERROR') {
      return (
        typeof error.message === 'string' &&
        HTTP2_STREAM_ERROR_RE.test(error.message) &&
        hasStackFrame(error.stack, 'emitStreamErrorNT (node:http2:')
      )
    }
    if (code === 'ERR_HTTP2_GOAWAY_SESSION') {
      return (
        error.message ===
          'New streams cannot be created after receiving a GOAWAY' &&
        hasStackFrame(error.stack, 'streamRejectedByGoawaySession (node:http2:')
      )
    }
    if (code === 'ERR_HTTP2_SESSION_ERROR') {
      return (
        typeof error.message === 'string' &&
        HTTP2_SESSION_ERROR_RE.test(error.message) &&
        hasStackFrame(error.stack, 'goaway (node:http2:')
      )
    }
    return false
  } catch {
    return false
  }
}

/** Official `dRa.markOwnsControllingTerminal()`. */
export function markOwnsControllingTerminal(): void {
  ownsControllingTerminal = true
}

/**
 * Official `dRa` SIGHUP handler (`chunk@294254613.js@380900`):
 * Ignore `SIGHUP` when `process.env.CLAUDE_BG_BACKEND === 'daemon'` unless the
 * process owns a controlling terminal; otherwise exit `129`.
 */
export function handleSighupSignal(): 'ignored_bg' | 'shutdown' {
  if (process.env.CLAUDE_BG_BACKEND === 'daemon') {
    if (ownsControllingTerminal) {
      preemptTerminalForShutdown()
      logForDiagnosticsNoPII('info', 'shutdown_signal', {
        signal: 'SIGHUP',
        bg_ctty: true,
      })
      void gracefulShutdown(129)
      return 'shutdown'
    }
    logForDiagnosticsNoPII('info', 'shutdown_signal', {
      signal: 'SIGHUP_ignored_bg',
    })
    return 'ignored_bg'
  }
  preemptTerminalForShutdown()
  logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGHUP' })
  void gracefulShutdown(129) // Exit code 129 (128 + 1) for SIGHUP
  return 'shutdown'
}

/**
 * Official `dRa.recordHttp2RecoveryAndCheckBudget(nowMs)`:
 * Allows up to 50 HTTP/2 stream teardown recoveries per 60,000ms window.
 */
export function recordHttp2RecoveryAndCheckBudget(
  nowMs: number = Date.now(),
): boolean {
  if (nowMs - http2RecoveryWindowStart > HTTP2_RECOVERY_WINDOW_MS) {
    http2RecoveryCount = 0
    http2RecoveryWindowStart = nowMs
  }
  http2RecoveryCount++
  return http2RecoveryCount <= HTTP2_RECOVERY_BUDGET
}

/**
 * Official `dRa.recordUncaughtAndCheckBreaker(nowMs)`:
 * Trips after 10 uncaught exceptions within a 5,000ms window.
 */
export function recordUncaughtAndCheckBreaker(
  nowMs: number = Date.now(),
): boolean {
  if (uncaughtBreakerTripped) return false
  if (nowMs - uncaughtWindowStart > UNCAUGHT_EXCEPTION_BREAKER_WINDOW_MS) {
    uncaughtCount = 0
    uncaughtWindowStart = nowMs
    recentUncaught = []
  }
  uncaughtCount++
  if (uncaughtCount >= UNCAUGHT_EXCEPTION_BREAKER_THRESHOLD) {
    uncaughtBreakerTripped = true
    return true
  }
  return false
}

/** Official `dRa.markStartupActionStarted(expectsUiMount)`. */
export function markStartupActionStarted(expectsUiMount: boolean): void {
  startupActionStarted = true
  startupExpectsUiMount = expectsUiMount
}

/** Disarm the startup-mount watchdog once the UI / REPL mounts. */
export function markStartupUiMounted(): void {
  startupUiMounted = true
  for (const timer of startupWatchdogTimers) {
    clearTimeout(timer)
  }
  startupWatchdogTimers.clear()
}

function inNonUiSubcommand(): boolean {
  return startupActionStarted && !startupExpectsUiMount
}

/**
 * Official `dRa.exitIfStartupNeverMounted(reason)` (`chunk@294254613.js@383500`):
 * Exit with code 1 if an uncaught startup error occurred and the UI never mounted.
 */
export function exitIfStartupNeverMounted(reason?: string): boolean {
  if (startupUiMounted || inNonUiSubcommand() || shutdownInProgress) {
    return false
  }
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs -- startup failure notice before exit
    writeSync(2, `Claude Code could not start: ${reason ?? '<unknown>'}\n`)
  } catch {
    // Ignore stderr write errors
  }
  void gracefulShutdown(1, 'other', { cause: 'startup_ui_never_appeared' })
  return true
}

/**
 * Official `dRa.scheduleStartupMountWatchdog(reason)` (10,000ms timer, unref'd).
 * Disarmed automatically when `markStartupUiMounted()` is called.
 */
export function scheduleStartupMountWatchdog(
  reason?: string,
  timeoutMs: number = STARTUP_MOUNT_WATCHDOG_MS,
): ReturnType<typeof setTimeout> | undefined {
  if (
    !getIsInteractive() ||
    startupUiMounted ||
    inNonUiSubcommand() ||
    shutdownInProgress
  ) {
    return undefined
  }
  const timer = setTimeout(() => {
    startupWatchdogTimers.delete(timer)
    exitIfStartupNeverMounted(reason)
  }, timeoutMs)
  timer.unref()
  startupWatchdogTimers.add(timer)
  return timer
}

function isSupervisedProcess(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_SUPERVISED)
}

function describeUncaught(err: unknown): {
  name: string
  message: string
  stack?: string
  isError: boolean
} {
  if (err instanceof Error) {
    return {
      name: typeof err.name === 'string' ? err.name : 'Error',
      message:
        typeof err.message === 'string' ? err.message.slice(0, 2000) : '',
      stack:
        typeof err.stack === 'string' ? err.stack.slice(0, 4000) : undefined,
      isError: true,
    }
  }
  if (typeof err === 'string') {
    return { name: 'string', message: err.slice(0, 2000), isError: false }
  }
  return {
    name: 'non-error',
    message: String(err).slice(0, 2000),
    isError: false,
  }
}

/**
 * Official `dRa` uncaughtException handler (`chunk@294254613.js@381500..382900`):
 * 1. HTTP/2 stream teardown recovery within 50/60s budget
 * 2. `CLAUDE_CODE_SUPERVISED` immediate exit (code 70)
 * 3. Loop circuit breaker: 10 uncaught exceptions within 5,000ms -> forced exit(1)
 * 4. Schedules 10,000ms startup-mount watchdog
 */
export function handleUncaughtException(
  error: unknown,
  nowMs: number = Date.now(),
):
  | 'breaker_already_tripped'
  | 'http2_recovered'
  | 'supervised_exit'
  | 'breaker_tripped'
  | 'logged' {
  if (uncaughtBreakerTripped) return 'breaker_already_tripped'
  const info = describeUncaught(error)
  const recovered =
    info.isError &&
    isHttp2StreamTeardownError(error) &&
    recordHttp2RecoveryAndCheckBudget(nowMs)

  logForDiagnosticsNoPII('error', 'uncaught_exception', {
    error_name: info.name,
    error_message: info.message,
    recovered,
  })
  logEvent('tengu_uncaught_exception', {
    error_name:
      info.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(recovered ? { recovered: true } : {}),
  })

  if (recovered) {
    logForDebugging(
      `Recovered HTTP/2 stream-teardown uncaught exception (${info.name})`,
    )
    return 'http2_recovered'
  }

  if (isSupervisedProcess()) {
    uncaughtBreakerTripped = true
    logForDebugging(
      `Uncaught exception under CLAUDE_CODE_SUPERVISED — exiting ${SUPERVISED_UNCAUGHT_EXIT_CODE}: ${info.name}`,
      { level: 'error' },
    )
    if (shutdownInProgress) {
      forceExit(SUPERVISED_UNCAUGHT_EXIT_CODE)
    }
    void gracefulShutdown(SUPERVISED_UNCAUGHT_EXIT_CODE, 'other', {
      cause: 'uncaught_exception',
    })
    return 'supervised_exit'
  }

  const tripped = recordUncaughtAndCheckBreaker(nowMs)
  if (recentUncaught.length < UNCAUGHT_RECENT_CAP || tripped) {
    recentUncaught.push({
      name: info.name,
      message: info.message.slice(0, 200),
    })
  }
  if (tripped) {
    logEvent('tengu_uncaught_exception_loop', {
      count: uncaughtCount,
      window_ms: UNCAUGHT_EXCEPTION_BREAKER_WINDOW_MS,
      error_name:
        info.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    cleanupTerminalModes()
    try {
      for (const entry of recentUncaught) {
        // eslint-disable-next-line custom-rules/no-sync-fs -- fatal loop diagnostics before exit
        writeSync(
          2,
          `Uncaught exception (loop): ${entry.name}: ${entry.message}\n`,
        )
      }
      // eslint-disable-next-line custom-rules/no-sync-fs -- fatal loop diagnostics before exit
      writeSync(
        2,
        `Uncaught exception loop detected (${uncaughtCount} in ${UNCAUGHT_EXCEPTION_BREAKER_WINDOW_MS}ms) — forcing shutdown\n`,
      )
    } catch {
      // Ignore stderr write errors
    }
    forceExit(1)
  }

  scheduleStartupMountWatchdog(info.message || info.name)
  return 'logged'
}

/**
 * Official `dRa` unhandledRejection handler (`chunk@294254613.js@382900..383400`):
 * Logs rejection, exits immediately under `CLAUDE_CODE_SUPERVISED`, and
 * schedules the 10,000ms startup-mount watchdog.
 */
export function handleUnhandledRejection(
  reason: unknown,
):
  | 'breaker_already_tripped'
  | 'swallowed_abort'
  | 'supervised_exit'
  | 'logged' {
  if (uncaughtBreakerTripped) return 'breaker_already_tripped'
  const info = describeUncaught(reason)
  const errorInfo = info.isError
    ? {
        error_name: info.name,
        error_message: info.message,
        ...(info.stack ? { error_stack: info.stack } : {}),
      }
    : { error_message: info.message }
  logForDiagnosticsNoPII('error', 'unhandled_rejection', errorInfo)
  logEvent('tengu_unhandled_rejection', {
    error_name:
      info.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  if (info.isError && info.name === 'AbortError') {
    logForDebugging(
      'Swallowed unhandled AbortError rejection (not exiting bg/supervised worker)',
    )
    return 'swallowed_abort'
  }
  if (isSupervisedProcess()) {
    uncaughtBreakerTripped = true
    logForDebugging(
      `Unhandled rejection under CLAUDE_CODE_SUPERVISED — exiting ${SUPERVISED_UNCAUGHT_EXIT_CODE}: ${info.name}`,
      { level: 'error' },
    )
    if (shutdownInProgress) {
      forceExit(SUPERVISED_UNCAUGHT_EXIT_CODE)
    }
    void gracefulShutdown(SUPERVISED_UNCAUGHT_EXIT_CODE, 'other', {
      cause: 'unhandled_rejection',
    })
    return 'supervised_exit'
  }
  scheduleStartupMountWatchdog(info.message || info.name)
  return 'logged'
}

/** Register an in-flight sandbox cleanup task so shutdown drains up to `SANDBOX_CLEANUP_WAIT_MS`. */
export function registerOwedSandboxCleanup(key: unknown): void {
  const cleanups = getShutdownHostState().owedSandboxCleanups
  if (!cleanups.has(key)) {
    const { promise, resolve } = Promise.withResolvers<void>()
    cleanups.set(key, { promise, resolve })
  }
}

/** Resolve a registered sandbox cleanup task (official `A0(e)`). */
export function resolveOwedSandboxCleanup(key: unknown): void {
  const cleanups = getShutdownHostState().owedSandboxCleanups
  cleanups.get(key)?.resolve()
  cleanups.delete(key)
}

/** Official `Len()`: combined promise of active host's sandbox cleanups, or null if none. */
export function getOwedSandboxCleanupPromise(): Promise<void> | null {
  const cleanups = getShutdownHostState().owedSandboxCleanups
  if (cleanups.size === 0) return null
  return Promise.all(
    Array.from(cleanups.values(), entry => entry.promise),
  ).then(() => {})
}

/** Process-exit drain across all live hosts' owed sandbox cleanups. */
function getAllHostsOwedSandboxCleanupPromise(): Promise<void> | null {
  const promises: Promise<void>[] = []
  for (const ref of shutdownHostStateRefs) {
    const hostState = ref.deref()
    if (hostState === undefined) {
      shutdownHostStateRefs.delete(ref)
      continue
    }
    for (const entry of hostState.owedSandboxCleanups.values()) {
      promises.push(entry.promise)
    }
  }
  if (promises.length === 0) return null
  return Promise.all(promises).then(() => {})
}

export function isUncaughtBreakerTrippedForTesting(): boolean {
  return uncaughtBreakerTripped
}

export function gracefulShutdownSync(
  exitCode = 0,
  reason: ExitReason = 'other',
  options?: {
    getAppState?: () => AppState
    setAppState?: (f: (prev: AppState) => AppState) => void
  },
): void {
  // Set the exit code that will be used when process naturally exits. Note that we do it
  // here inside the sync version too so that it is possible to determine if
  // gracefulShutdownSync was called by checking process.exitCode.
  process.exitCode = exitCode

  pendingShutdown = gracefulShutdown(exitCode, reason, options)
    .catch(error => {
      logForDebugging(`Graceful shutdown failed: ${error}`, { level: 'error' })
      cleanupTerminalModes()
      printResumeHint()
      forceExit(exitCode)
    })
    // Prevent unhandled rejection: forceExit re-throws in test mode,
    // which would escape the .catch() handler above as a new rejection.
    .catch(() => {})
}

let shutdownInProgress = false
let failsafeTimer: ReturnType<typeof setTimeout> | undefined
let failsafeFiresAtMs: number | undefined
let orphanCheckInterval: ReturnType<typeof setInterval> | undefined
let pendingShutdown: Promise<void> | undefined
let shortenOAuthRefreshWait: (() => void) | undefined

/** Official 325 `F6a = 15000` — minimum failsafe when background work is pending at exit (#765). */
export const BACKGROUND_EXIT_FAILSAFE_MIN_MS = 15000

const pendingBackgroundShutdownWork = new Set<Promise<unknown>>()

/** Official 325 `O6i` / `z_a` — track a background write/command promise to drain at exit (#765). */
export function trackBackgroundShutdownWork(promise: Promise<unknown>): void {
  pendingBackgroundShutdownWork.add(promise)
  void promise
    .finally(() => {
      pendingBackgroundShutdownWork.delete(promise)
    })
    .catch(() => {
      // Prevent unhandled rejection from the derived .finally() promise.
    })
}

/** Official 325 `mqt()` / `wZt()` — true when background writes/commands are pending at exit (#765). */
export function hasPendingBackgroundShutdownWork(): boolean {
  return pendingBackgroundShutdownWork.size > 0
}

/** Official 325 `gqt()` / `TZt()` — drain tracked background work before SessionEnd hooks (#765). */
export async function drainBackgroundShutdownWork(): Promise<void> {
  while (pendingBackgroundShutdownWork.size > 0) {
    await Promise.allSettled([...pendingBackgroundShutdownWork])
  }
}

/** Official 325 `V2e = 2000`, `MVa = 8500` — OAuth refresh lock wait constants (#860). */
export const OAUTH_REFRESH_WAIT_MS = 2000
export const OAUTH_REFRESH_SHORT_CMD_CAP_MS = 8500

/** Acquire an in-flight OAuth refresh hold; returns a release callback (#860). */
export function acquireOAuthRefreshHold(): () => void {
  return beginOAuthRefreshLockHold()
}

/** Official 325 `O4t()` — returns a promise if an OAuth refresh lock is held, else null (#860). */
export function getHeldOAuthRefreshPromise(): Promise<void> | null {
  return getAuthHeldOAuthRefreshPromise()
}

/** Official 325 `Sjo()` — short non-interactive commands get up to 8.5s minus uptime (#860). */
export function getHeldOAuthRefreshTimeoutMs(): number {
  return getIsNonInteractiveSession()
    ? Math.max(
        OAUTH_REFRESH_WAIT_MS,
        OAUTH_REFRESH_SHORT_CMD_CAP_MS - process.uptime() * 1000,
      )
    : OAUTH_REFRESH_WAIT_MS
}

/** Official 325 `I4t(e)` — await held OAuth refresh release up to `timeoutMs` (#860). */
export async function waitForOAuthRefreshRelease(
  timeoutMs: number,
): Promise<boolean> {
  return waitForAuthHeldOAuthRefresh(timeoutMs)
}

function armShutdownFailsafe(budgetMs: number, exitCode: number): void {
  if (failsafeTimer !== undefined) {
    clearTimeout(failsafeTimer)
    failsafeTimer = undefined
  }
  const sessionRef = new WeakRef(getBootstrapSession().root)
  failsafeFiresAtMs = Date.now() + budgetMs
  failsafeTimer = setTimeout(
    (code: number) => {
      cleanupTerminalModes()
      const targetSession = sessionRef.deref()
      if (targetSession !== undefined) {
        runWithSession(targetSession, printResumeHint)
      } else {
        printResumeHint()
      }
      // densable EDs body: fVt(500,{scaleBudgetToQueue:!1}).then(()=>ADs(r))
      markStdoutDrainExternallyClocked()
      void drainStdoutBeforeExit(500, { scaleBudgetToQueue: false })
        .catch(() => {})
        .finally(() => {
          forceExit(code)
        })
    },
    budgetMs,
    exitCode,
  )
  failsafeTimer.unref()
}

/** Official 325 `waitForHeldOAuthRefresh(e)` (#860). */
export async function waitForHeldOAuthRefresh(
  exitCode: number,
): Promise<boolean> {
  if (getHeldOAuthRefreshPromise() === null) return true
  const timeoutMs =
    exitCode === 0 ? getHeldOAuthRefreshTimeoutMs() : OAUTH_REFRESH_WAIT_MS
  if (failsafeFiresAtMs !== undefined) {
    armShutdownFailsafe(
      Math.max(0, failsafeFiresAtMs - Date.now()) + timeoutMs,
      exitCode,
    )
  }
  const released = waitForOAuthRefreshRelease(timeoutMs)
  if (timeoutMs === OAUTH_REFRESH_WAIT_MS) return released
  const startedAt = Date.now()
  const { promise, resolve } = Promise.withResolvers<boolean>()
  shortenOAuthRefreshWait = () => {
    setTimeout(
      resolve,
      Math.max(0, startedAt + OAUTH_REFRESH_WAIT_MS - Date.now()),
      false,
    )
  }
  return Promise.race([released, promise])
}

/** Check if graceful shutdown is in progress */
export function isShuttingDown(): boolean {
  return shutdownInProgress
}

/** Official qje — tb().claimShutdown() on leftover `_G`. */
export function claimShutdown(): void {
  shutdownInProgress = true
  if (orphanCheckInterval !== undefined) {
    clearInterval(orphanCheckInterval)
    orphanCheckInterval = undefined
  }
}

/** Official tb().releaseShutdownClaim() — undo tentative claim before commit. */
export function releaseShutdownClaim(): void {
  shutdownInProgress = false
}

function widenFailsafeBy(extraMs: number, exitCode: number): void {
  if (extraMs > 0 && failsafeFiresAtMs !== undefined) {
    armShutdownFailsafe(
      Math.max(0, failsafeFiresAtMs - Date.now()) + extraMs,
      exitCode,
    )
  }
}

export function getFailsafeFiresAtMsForTesting(): number | undefined {
  return failsafeFiresAtMs
}

/** Reset shutdown state - only for use in tests */
export function resetShutdownState(): void {
  shutdownInProgress = false
  resetShutdownCommittedForTests()
  const hostState = getShutdownHostState()
  hostState.resumeHintPrinted = false
  hostState.resumeHintOmitsWorktree = false
  hostState.resumeHintLaunchFlags = undefined
  hostState.interactiveShutdownAbort = null
  printModeSignalHandlersRegistered = false
  ownsControllingTerminal = false
  uncaughtCount = 0
  uncaughtWindowStart = 0
  uncaughtBreakerTripped = false
  recentUncaught = []
  http2RecoveryCount = 0
  http2RecoveryWindowStart = 0
  startupActionStarted = false
  startupExpectsUiMount = false
  startupUiMounted = false
  for (const timer of startupWatchdogTimers) {
    clearTimeout(timer)
  }
  startupWatchdogTimers.clear()
  hostState.owedSandboxCleanups.clear()
  if (failsafeTimer !== undefined) {
    clearTimeout(failsafeTimer)
    failsafeTimer = undefined
  }
  failsafeFiresAtMs = undefined
  shortenOAuthRefreshWait = undefined
  pendingBackgroundShutdownWork.clear()
  resetOAuthRefreshHoldForTesting()
  pendingShutdown = undefined
}

/**
 * Returns the in-flight shutdown promise, if any. Only for use in tests
 * to await completion before restoring mocks.
 */
export function getPendingShutdownForTesting(): Promise<void> | undefined {
  return pendingShutdown
}

export type WorktreeRemovalTask = {
  path: string
  run: () => Promise<string | undefined>
  budgetMs?: number
  ignoresHangup?: boolean
}

export async function inspectWorktreeSafetyBeforeShutdownRemoval(): Promise<{
  keep: boolean
  reason?: string
  state?: WorktreeHeadState
}> {
  const session = getCurrentWorktreeSession()
  if (!session || !session.worktreeBranch) {
    return { keep: false }
  }
  const state = await inspectWorktreeHeadState({
    worktreePath: session.worktreePath,
    worktreeBranch: session.worktreeBranch,
    originalHeadCommit: session.originalHeadCommit,
  })
  if (
    (state.head === 'detached' ||
      state.head === 'another_branch' ||
      state.head === 'like_its_branch') &&
    (state.commits === null || state.commits > 0)
  ) {
    const desc = formatWorktreeCommitDescription(
      state,
      session.worktreeBranch,
      session.originalHeadCommit ?? 'the base commit',
    )
    return {
      keep: true,
      reason: `Kept worktree ${session.worktreePath}: commits exist ${desc}.`,
      state,
    }
  }
  return { keep: false, state }
}

function isWorktreeRemovalTask(value: unknown): value is WorktreeRemovalTask {
  return (
    value !== null &&
    typeof value === 'object' &&
    'path' in value &&
    typeof (value as { path: unknown }).path === 'string' &&
    'run' in value &&
    typeof (value as { run: unknown }).run === 'function'
  )
}

// Graceful shutdown function that drains the event loop
export async function gracefulShutdown(
  exitCode = 0,
  reason: ExitReason = 'other',
  options?: {
    getAppState?: () => AppState
    setAppState?: (f: (prev: AppState) => AppState) => void
    /** Printed to stderr after alt-screen exit, before forceExit. */
    finalMessage?: string
    /**
     * Official background-exit path suppresses the normal "claude --resume"
     * hint because the session was handed off to a background job.
     */
    suppressResumeHint?: boolean
    /**
     * When set, omit `--worktree <name>` from the printed resume hint
     * (densable WMo.resumeHintOmitsWorktree).
     */
    removeWorktree?: WorktreeRemovalTask | unknown
    /** Optional diagnostic shutdown cause (official `dRa.shutdown`). */
    cause?: string
  },
): Promise<void> {
  if (shutdownInProgress) {
    shortenOAuthRefreshWait?.()
    return
  }
  shutdownInProgress = true
  markShutdownCommitted()

  // densable nst/WFl: Q6e(..., "process_exit") before oc(0, "prompt_input_exit").
  // Wire cancel here so every prompt_input_exit path clears quota auto-resume
  // (exitPromptShutdown, ExitFlow, /exit, BackgroundAndExit after handoff).
  // Idempotent if caller already cancelled with background_handoff.
  if (reason === 'prompt_input_exit') {
    try {
      const { cancelQuotaAutoResume } = await import(
        '../services/quotaAutoResume.js'
      )
      cancelQuotaAutoResume('process_exit')
    } catch {
      // best-effort — never block shutdown
    }
  }

  // Set the exit code that will be used when process naturally exits
  process.exitCode = exitCode

  // Official background handoff suppresses the resume hint (session continues).
  const hostState = getShutdownHostState()
  if (options?.suppressResumeHint) {
    hostState.resumeHintPrinted = true
  }
  hostState.resumeHintOmitsWorktree = options?.removeWorktree !== undefined

  // Exit alt screen and print resume hint FIRST, before any async operations
  // (including dynamic import of hooks). Previously we awaited import('./hooks.js')
  // before cleanupTerminalModes — on Ctrl+C that left mouse tracking on long
  // enough for SGR "move…" garbage + stacked main-buffer frames (Windows).
  // signal handlers also call preemptTerminalForShutdown() for the earliest
  // mouse-off; this is the full unmount/reset path.
  cleanupTerminalModes()
  printResumeHint()

  // Resolve the SessionEnd hook budget before arming the failsafe so the
  // failsafe can scale with it. Without this, a user-configured 10s hook
  // budget is silently truncated by the 5s failsafe (gh-32712 follow-up).
  // Import AFTER terminal cleanup so module load latency cannot leak mouse bytes.
  const {
    executeSessionEndHooks,
    getSessionEndHookTimeoutMs,
    getSessionEndHooksBoundMs,
  } = await import('./hooks.js')
  const sessionEndTimeoutMs = getSessionEndHookTimeoutMs()
  const sessionEndBoundMs = getSessionEndHooksBoundMs()

  // Failsafe: guarantee process exits even if cleanup hangs (e.g., MCP connections).
  // Runs cleanupTerminalModes first so a hung cleanup doesn't leave the terminal dirty.
  // densable FMd/EDs: budget includes zRn()+P8y (1500) so stream-json drain
  // headroom is not truncated by a fixed 5s; failsafe body drains 500ms
  // unscaled before forceExit (scaleBudgetToQueue:false).
  // Local also keeps sessionEndHooks budget: max(5s, hooks+3.5s, drain+1.5s).
  const drainBudgetMs = getStdoutDrainBudgetMs()
  const FAILSAFE_DRAIN_HEADROOM_MS = 1500 // densable P8y
  const baseFailsafeMs = Math.max(
    5000,
    sessionEndBoundMs + 3500,
    drainBudgetMs + FAILSAFE_DRAIN_HEADROOM_MS,
  )
  armShutdownFailsafe(baseFailsafeMs, exitCode)

  // Flush session data first — this is the most critical cleanup. If the
  // terminal is dead (SIGHUP, SSH disconnect), hooks and analytics may hang
  // on I/O to a dead TTY or unreachable network, eating into the
  // failsafe budget. Session persistence must complete before anything else.
  // densable DZr: settle in-flight PR-link promises (2s cap) before other cleanup
  // so immediate exit after gh pr create does not drop pr-link transcript rows.
  try {
    const { flushPendingPrLinks } = await import(
      '@claude-code/builtin-tools/tools/shared/gitOperationTracking.js'
    )
    const prFlush = flushPendingPrLinks()
    trackBackgroundShutdownWork(prFlush)
    await prFlush
  } catch {
    // best-effort — do not block shutdown on PR-link flush failures
  }
  let cleanupTimeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const cleanupPromise = (async () => {
      try {
        await runCleanupFunctions()
      } catch {
        // Silently ignore cleanup errors
      }
    })()

    // densable: race mEe() against tde=2000 (CLEANUP_DRAIN_TIMEOUT_MS)
    await Promise.race([
      cleanupPromise,
      new Promise((_, reject) => {
        cleanupTimeoutId = setTimeout(
          rej => rej(new CleanupTimeoutError()),
          CLEANUP_DRAIN_TIMEOUT_MS,
          reject,
        )
      }),
    ])
    clearTimeout(cleanupTimeoutId)
  } catch {
    // Silently handle timeout and other errors
    clearTimeout(cleanupTimeoutId)
  }

  // 2.1.300 #765 (SEA mqt/F6a/gqt, 2.1.328 wZt/Mbl/TZt): If background work is
  // pending at exit, extend failsafe to at least 15s (or sessionEndBoundMs + 5s)
  // and drain all tracked background work before killing shell commands and
  // running SessionEnd hooks.
  if (hasPendingBackgroundShutdownWork()) {
    armShutdownFailsafe(
      Math.max(BACKGROUND_EXIT_FAILSAFE_MIN_MS, sessionEndBoundMs + 5000),
      exitCode,
    )
  }
  try {
    await drainBackgroundShutdownWork()
  } catch {
    // best-effort
  }

  // Official 2.1.328 #644: in headless/non-interactive exit, wait (with
  // bounded timeout) for any in-flight headless enabled-plugin record/fetch
  // pass to drain before killing child processes and exiting.
  if (getIsNonInteractiveSession()) {
    try {
      const { waitForHeadlessPluginInstallDrain } = await import(
        './plugins/headlessPluginInstall.js'
      )
      const pluginDrain = waitForHeadlessPluginInstallDrain()
      trackBackgroundShutdownWork(pluginDrain)
      await pluginDrain
    } catch {
      // best-effort — never block shutdown
    }
  }

  // 2.1.300 #810 (SEA rkr/Htn): kill live background shell commands and wait up
  // to 1.5s (SHELL_KILL_BACKSTOP_MS) for SIGKILL backstops before exiting.
  try {
    const { awaitPendingShellKillBackstops, killLiveShellCommands } =
      await import('../tasks/LocalShellTask/killShellTasks.js')
    killLiveShellCommands()
    await awaitPendingShellKillBackstops()
  } catch {
    // best-effort — never block shutdown
  }

  // #987 + Official 2.1.328 `dRa.removeWorktreeAtExit` (`chunk@294254613.js@389400`):
  // Inspect worktree HEAD state and run `removeWorktree` STRICTLY ONCE before
  // SessionEnd hooks, widening the failsafe timeout to cover `budgetMs` so a
  // large worktree removal is not killed prematurely by the 5s failsafe.
  if (isWorktreeRemovalTask(options?.removeWorktree)) {
    try {
      const safety = await inspectWorktreeSafetyBeforeShutdownRemoval()
      if (safety.keep) {
        if (safety.reason) {
          try {
            // eslint-disable-next-line custom-rules/no-sync-fs -- must flush before exit
            writeSync(2, safety.reason + '\n')
          } catch {
            // ignore stderr write errors
          }
        }
      } else {
        const budgetMs =
          options.removeWorktree.budgetMs ?? WORKTREE_REMOVAL_DEFAULT_BUDGET_MS
        if (failsafeFiresAtMs !== undefined) {
          armShutdownFailsafe(
            Math.max(failsafeFiresAtMs - Date.now(), budgetMs + baseFailsafeMs),
            exitCode,
          )
        }
        try {
          await Promise.race([options.removeWorktree.run(), sleep(budgetMs)])
        } finally {
          if (failsafeFiresAtMs !== undefined) {
            armShutdownFailsafe(baseFailsafeMs, exitCode)
          }
        }
      }
    } catch {
      // best-effort — never block shutdown
    }
  }

  // Execute SessionEnd hooks. Per-hook default is `_go` (env ?? 1500);
  // overall AbortSignal is `Kfe` (env if set, else matcher timeout clamp).
  try {
    await executeSessionEndHooks(reason, {
      ...options,
      signal: AbortSignal.timeout(sessionEndBoundMs),
      timeoutMs: sessionEndTimeoutMs,
    })
  } catch {
    // Ignore SessionEnd hook exceptions (including AbortError on timeout)
  }

  try {
    const { awaitPendingShellKillBackstops, killLiveShellCommands } =
      await import('../tasks/LocalShellTask/killShellTasks.js')
    killLiveShellCommands()
    await awaitPendingShellKillBackstops()
  } catch {
    // best-effort — never block shutdown
  }

  // Official 2.1.328 `dRa` (`chunk@294254613.js@389800`):
  // Drain active sandbox cleanup (owed sandbox cleanups / SandboxManager reset
  // when sandbox was active) bounded by SANDBOX_CLEANUP_WAIT_MS (500ms).
  try {
    const owedSandbox = getAllHostsOwedSandboxCleanupPromise()
    let activeSandboxReset: Promise<void> | null = null
    if (owedSandbox === null) {
      const { hasSandboxStartedOnce, SandboxManager } = await import(
        './sandbox/sandbox-adapter.js'
      )
      if (hasSandboxStartedOnce()) {
        activeSandboxReset = SandboxManager.reset()
      }
    }
    const sandboxCleanup = owedSandbox ?? activeSandboxReset
    if (sandboxCleanup !== null) {
      widenFailsafeBy(SANDBOX_CLEANUP_WAIT_MS, exitCode)
      await Promise.race([
        sandboxCleanup.catch(() => {}),
        sleep(SANDBOX_CLEANUP_WAIT_MS),
      ])
    }
  } catch {
    // best-effort — never block shutdown
  }

  // Log startup perf before analytics shutdown flushes/cancels timers
  try {
    profileReport()
  } catch {
    // Ignore profiling errors during shutdown
  }

  // Signal to inference that this session's cache can be evicted.
  // Fires before analytics flush so the event makes it to the pipeline.
  const lastRequestId = getLastMainRequestId()
  if (lastRequestId) {
    logEvent('tengu_cache_eviction_hint', {
      scope:
        'session_end' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      last_request_id:
        lastRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // Official DTo densable — tengu_scroll_summary before analytics sinks close.
  emitScrollTelemetrySummary()

  // Flush analytics — capped at 500ms. Previously unbounded: the 1P exporter
  // awaits all pending axios POSTs (10s each), eating the full failsafe budget.
  // Lost analytics on slow networks are acceptable; a hanging exit is not.
  try {
    await Promise.race([
      Promise.all([
        shutdown1PEventLogging(),
        shutdownDatadog(),
        closeSentry(2000),
      ]),
      sleep(500),
    ])
  } catch {
    // Ignore analytics shutdown errors
  }

  // 2.1.301 #860 (SEA waitForHeldOAuthRefresh): Wait for any held OAuth token
  // refresh lock before exiting so short commands do not time out / sign out.
  try {
    const settled = await waitForHeldOAuthRefresh(exitCode)
    if (settled && getHeldOAuthRefreshPromise() !== null) {
      await waitForHeldOAuthRefresh(exitCode)
    }
  } catch {
    // best-effort — never block shutdown
  }

  if (options?.finalMessage) {
    try {
      // eslint-disable-next-line custom-rules/no-sync-fs -- must flush before forceExit
      writeSync(2, options.finalMessage + '\n')
    } catch {
      // stderr may be closed (e.g., SSH disconnect). Ignore write errors.
    }
  }

  // densable FMd: await fVt() before ADs(forceExit) — scale drain to
  // stream-json queue depth so large result payloads are not truncated
  // by a fixed 2s budget (2.1.214 #19).
  try {
    await drainStdoutBeforeExit()
  } catch {
    // drain never throws by design; belt-and-suspenders
  }

  forceExit(exitCode)
}

class CleanupTimeoutError extends Error {
  constructor() {
    super('Cleanup timeout')
  }
}
