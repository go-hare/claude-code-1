/**
 * densable 2.1.248 Mhr — `/update` / `/restart` call body.
 *
 * Gold refuse order:
 * 1. bg + (!daemon backend || !CLAUDE_JOB_DIR) → detach/respawn copy
 * 2. foreground transcript path drift
 * 3. g(): wU(he(t), GC()) uncarriable (foreground only)
 * 4. hoe / active tasks
 * then bg detached respawn **or** foreground `_G`/Ket via acceptTuiRelaunch
 * (o5/i5 extraArgs, env `$B()`+team+s5, no TUI_JUST_SWITCHED / no Yk).
 *
 * Tip gate keeps this hidden; call is still the official body for GC alignment.
 */
import { spawn } from 'child_process'
import { homedir } from 'os'
import { basename } from 'path'
import {
  getSessionId,
  isSessionPersistenceDisabled,
} from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppStateStore.js'
import type { LocalCommandCall } from '../../types/command.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  acceptTuiRelaunch,
  flushStreamsBeforeRelaunchExit,
} from '../../utils/cliRelaunch.js'
import { buildCliLaunch, spawnCli } from '../../utils/cliLaunch.js'
import {
  isBgSession,
  registryJobIdFromEnv,
} from '../../utils/concurrentSessions.js'
import {
  formatUpdateUncarriableRefuseMessage,
  getSessionRelaunchUncarriableReasons,
} from '../../utils/sessionRelaunchUncarriable.js'
import {
  getTuiRelaunchBlocker,
  isCommentMonitorTask,
  isGlobalCommentMonitorActive,
  type TuiRelaunchBlocker,
} from '../../utils/tuiRelaunchBlocker.js'
function logUpdateRefused(payload: {
  [key: string]: boolean | number | undefined
}): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { logEvent } =
      require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
    logEvent('tengu_update_refused', payload)
  } catch {
    // analytics optional
  }
}

/** densable RW() — `CLAUDE_BG_BACKEND==="daemon"`. */
export function isDaemonBgBackend(
  backend: string | undefined = process.env.CLAUDE_BG_BACKEND,
): boolean {
  return backend === 'daemon'
}

/** densable Uc() — job short for respawn copy. */
export function getUpdateRespawnShortId(): string | undefined {
  const fromJob = registryJobIdFromEnv()
  if (fromJob) return fromJob
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBgJobDirectory } =
      require('../../utils/sessionNameJobSidecar.js') as typeof import('../../utils/sessionNameJobSidecar.js')
    const dir = getBgJobDirectory()
    if (dir) {
      const id = basename(dir)
      if (id) return id
    }
  } catch {
    /* optional */
  }
  try {
    const sid = getSessionId()
    if (typeof sid === 'string' && sid.length >= 8) return sid.slice(0, 8)
  } catch {
    /* bootstrap unset in tests */
  }
  return undefined
}

/** densable fKt(tasks) — any live comment-monitor signal. */
export function hasUpdateCommentMonitor(
  tasks: Record<string, unknown> | Parameters<typeof getTuiRelaunchBlocker>[0],
): boolean {
  if (isGlobalCommentMonitorActive()) return true
  const values = Array.isArray(tasks)
    ? tasks
    : Symbol.iterator in Object(tasks)
      ? Array.from(tasks as Iterable<unknown>)
      : Object.values(tasks as Record<string, unknown>)
  return values.some(t =>
    isCommentMonitorTask(t as { status?: string; autoReactArmed?: boolean }),
  )
}

/** densable Mhr bg refuse copy. */
export function formatUpdateBgSessionRefuseMessage(
  shortId: string | undefined,
  canAutoRespawn: boolean,
): string {
  // Official: e=RW()?null:Uc() — only embed id when NOT daemon-capable.
  const id = canAutoRespawn ? undefined : shortId
  if (id) {
    return `This is a background session \u2014 press \u2190 to detach, then run \`claude respawn ${id}\` to restart it on the latest build.`
  }
  return 'This is a background session \u2014 press \u2190 to detach, then run `claude respawn <id>` to restart it on the latest build (the id is in the agents view).'
}

/** densable Mhr transcript_path_drift refuse. */
export function formatUpdateTranscriptDriftRefuseMessage(
  commentMonitor: boolean,
): string {
  const suffix = commentMonitor
    ? ' (restarting stops the auto-replies to artifact comments)'
    : ''
  return `Cannot /update \u2014 this session was resumed from a different project directory. Restart manually with --resume to continue on the latest version${suffix}.`
}

/** densable Mhr hoe / h() refuse — not the /tui renderer copy. */
export function formatUpdateActiveTaskRefuseMessage(
  blocker: TuiRelaunchBlocker,
): string {
  if (blocker.kind === 'comment_monitor') {
    return "Can't restart while auto-replying to artifact comments \u2014 restarting would stop the replies. Stop the artifact comment monitor via /tasks (or ask Claude to stop it), then try again."
  }
  return "Can't restart while work is running in the background \u2014 wait for it to finish (or stop it via /tasks), then try again."
}

function scrubBgRespawnEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env }
  delete next.CLAUDE_JOB_DIR
  for (const key of Object.keys(next)) {
    if (key.startsWith('CLAUDE_BG_')) delete next[key]
  }
  return next
}

async function tryBgDetachedRespawn(
  shortId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const launch = buildCliLaunch(['respawn', shortId], {
      env: scrubBgRespawnEnv(),
    })
    const child = spawnCli(launch, {
      detached: true,
      stdio: 'ignore',
      cwd: homedir(),
    })
    child.unref()
    return { ok: true }
  } catch {
    try {
      const script = process.argv[1]
      const child = spawn(
        process.execPath,
        [
          ...(process.execArgv ?? []),
          ...(script ? [script] : []),
          'respawn',
          shortId,
        ],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: scrubBgRespawnEnv(),
          cwd: homedir(),
        },
      )
      child.unref()
      return { ok: true }
    } catch (e2) {
      const detail = e2 instanceof Error ? e2.message : String(e2)
      return { ok: false, error: detail }
    }
  }
}

/**
 * official Mhr bridge arm: EBt writeSdkMessages + skip-archive + s5().
 */
async function prepareBridgeSkipArchive(
  setAppState: (updater: (prev: AppState) => AppState) => void,
): Promise<Record<string, string> | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getReplBridgeHandle } =
      require('../../bridge/replBridgeHandle.js') as typeof import('../../bridge/replBridgeHandle.js')
    const bridge = getReplBridgeHandle()
    if (!bridge?.bridgeSessionId) return undefined
    setAppState(s =>
      s.replBridgeSkipNextArchive
        ? s
        : { ...s, replBridgeSkipNextArchive: true },
    )
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createRelaunchSdkAssistantMessage, RELAUNCH_BRIDGE_SDK_COPY } =
        require('../../utils/sessionRelaunchSnapshot.js') as typeof import('../../utils/sessionRelaunchSnapshot.js')
      bridge.writeSdkMessages([
        createRelaunchSdkAssistantMessage(
          RELAUNCH_BRIDGE_SDK_COPY,
          getSessionId(),
        ),
      ])
    } catch {
      /* leftover EBt best-effort */
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { withTimeout } =
        require('../../utils/sleep.js') as typeof import('../../utils/sleep.js')
      await withTimeout(
        Promise.resolve(bridge.flush?.() ?? undefined),
        2000,
        'bridge flush',
      )
    } catch {
      /* official qt(...).catch(()=>{}) */
    }
    try {
      await bridge.teardown({ skipArchive: true })
    } catch {
      /* best-effort */
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { buildBridgeReattachEnv, resolveBridgeReattachOwnerMeta } =
        require('../../cli/bg/leftArrowAgents.js') as typeof import('../../cli/bg/leftArrowAgents.js')
      // official s5(S, E, I, T, kGe) — leftover rit + leftover kGe
      const { getPersistedBridgeSession } =
        require('../../bridge/bridgeSessionMeta.js') as typeof import('../../bridge/bridgeSessionMeta.js')
      const ownerMeta = resolveBridgeReattachOwnerMeta(
        bridge,
        getPersistedBridgeSession(),
      )
      return buildBridgeReattachEnv(bridge.bridgeSessionId, {
        seq: bridge.getLastSequenceNum?.(),
        outboundOnly: bridge.outboundOnly,
        grouping: bridge.sessionGroupingId,
        ...ownerMeta,
      })
    } catch {
      return undefined
    }
  } catch {
    /* bridge optional */
  }
  return undefined
}

export const call: LocalCommandCall = async (_args, context) => {
  const appState = context.getAppState()
  const ctx = appState.toolPermissionContext ?? getEmptyToolPermissionContext()
  const tasks = (appState.tasks ?? {}) as Parameters<
    typeof getTuiRelaunchBlocker
  >[0]
  const bg = isBgSession()
  const jobDir = bg ? process.env.CLAUDE_JOB_DIR : undefined
  const daemonBg = isDaemonBgBackend()
  // 1. bg refuse when not daemon-capable or missing job dir (official RW/Uc)
  if (bg && (!daemonBg || !jobDir)) {
    logUpdateRefused({ bg_session: true })
    return {
      type: 'text',
      value: formatUpdateBgSessionRefuseMessage(
        getUpdateRespawnShortId(),
        daemonBg,
      ),
    }
  }
  const commentMonitor = hasUpdateCommentMonitor(tasks)
  // 2. foreground transcript path drift (only when !jobDir)
  if (!jobDir) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getProject } =
        require('../../utils/sessionStorage.js') as typeof import('../../utils/sessionStorage.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getTranscriptPath } =
        require('../../utils/sessionPaths.js') as typeof import('../../utils/sessionPaths.js')
      const sessionFile = getProject().sessionFile
      const expected = getTranscriptPath()
      if (sessionFile && sessionFile !== expected) {
        logUpdateRefused({
          transcript_path_drift: true,
          comment_monitor: commentMonitor,
        })
        return {
          type: 'text',
          value: formatUpdateTranscriptDriftRefuseMessage(commentMonitor),
        }
      }
    } catch {
      /* storage optional in tests */
    }
  }
  const autoRepliesCarried = (() => {
    if (jobDir === undefined) return false
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isBgExitHandoffDisabled } =
        require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
      // official dxt() = j6() && !DISABLE_BG_EXIT_HANDOFF — leftover: handoff on
      return !isBgExitHandoffDisabled()
    } catch {
      return true
    }
  })()
  const activeBlocker = (): TuiRelaunchBlocker | undefined =>
    getTuiRelaunchBlocker(tasks, { autoRepliesCarried })
  // 3–4. foreground: uncarriable then tasks; bg daemon: tasks only
  if (!jobDir) {
    const reasons = getSessionRelaunchUncarriableReasons(ctx)
    if (reasons.length > 0) {
      logUpdateRefused({
        uncarriable: true,
        comment_monitor: commentMonitor,
      })
      return {
        type: 'text',
        value: formatUpdateUncarriableRefuseMessage(reasons, {
          sessionPersistenceDisabled: isSessionPersistenceDisabled(),
          commentMonitor,
        }),
      }
    }
  }
  const blocker = activeBlocker()
  if (blocker !== undefined) {
    logUpdateRefused({
      active_tasks: blocker.activeTasks,
      comment_monitor: blocker.kind === 'comment_monitor',
    })
    return {
      type: 'text',
      value: formatUpdateActiveTaskRefuseMessage(blocker),
    }
  }
  // 5a. bg daemon + jobDir → detached respawn
  if (jobDir) {
    const shortId = basename(jobDir)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { flushSessionStorage } =
        require('../../utils/sessionStorage.js') as typeof import('../../utils/sessionStorage.js')
      await flushSessionStorage()
    } catch {
      logUpdateRefused({ bg_flush_failed: true })
      return {
        type: 'text',
        value:
          "Couldn't save the session to disk, so nothing was restarted \u2014 try /restart again in a moment.",
      }
    }
    const recheck = activeBlocker()
    if (recheck !== undefined) {
      return {
        type: 'text',
        value: formatUpdateActiveTaskRefuseMessage(recheck),
      }
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logEvent } =
        require('../../services/analytics/index.js') as typeof import('../../services/analytics/index.js')
      logEvent('tengu_update_bg_respawn', {
        carried_comment_monitor: commentMonitor,
      })
    } catch {
      /* optional */
    }
    const spawned = await tryBgDetachedRespawn(shortId)
    if (!spawned.ok) {
      logUpdateRefused({ bg_spawn_failed: true })
      return {
        type: 'text',
        value: `Couldn't restart automatically \u2014 press \u2190 to detach, then run \`claude respawn ${shortId}\` to restart it on the latest build.`,
      }
    }
    return {
      type: 'text',
      value: `Restarting this session on the latest version\u2026 If it doesn't come back within a minute, run \`claude respawn ${shortId}\` from a terminal.`,
    }
  }
  // 5b. foreground relaunch
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { flushSessionStorage } =
      require('../../utils/sessionStorage.js') as typeof import('../../utils/sessionStorage.js')
    await flushSessionStorage()
  } catch {
    // densable lR best-effort
  }
  // official g(!0) after lR — uncarriable then hoe, deferred:true
  const afterFlushReasons = getSessionRelaunchUncarriableReasons(ctx)
  if (afterFlushReasons.length > 0) {
    logUpdateRefused({
      uncarriable: true,
      comment_monitor: commentMonitor,
      deferred: true,
    })
    return {
      type: 'text',
      value: formatUpdateUncarriableRefuseMessage(afterFlushReasons, {
        sessionPersistenceDisabled: isSessionPersistenceDisabled(),
        commentMonitor,
      }),
    }
  }
  const afterFlush = activeBlocker()
  if (afterFlush !== undefined) {
    logUpdateRefused({
      active_tasks: afterFlush.activeTasks,
      comment_monitor: afterFlush.kind === 'comment_monitor',
      deferred: true,
    })
    return {
      type: 'text',
      value: formatUpdateActiveTaskRefuseMessage(afterFlush),
    }
  }

  // official A=[...o5(w,wle(t)),...i5(w,AL())] then ha()/lUe()/g(!0)
  // leftover Cmt+Rmt via toolPermissionContext → buildTuiRelaunchExtraArgs
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { assertProcessWrapperRunnableForRelaunch } =
      require('../../utils/processWrapper.js') as typeof import('../../utils/processWrapper.js')
    // official await lUe()
    assertProcessWrapperRunnableForRelaunch()
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return {
      type: 'text',
      value: `Couldn't restart Claude Code \u2014 ${detail}`,
    }
  }
  const afterLueReasons = getSessionRelaunchUncarriableReasons(ctx)
  if (afterLueReasons.length > 0) {
    logUpdateRefused({
      uncarriable: true,
      comment_monitor: commentMonitor,
      deferred: true,
    })
    return {
      type: 'text',
      value: formatUpdateUncarriableRefuseMessage(afterLueReasons, {
        sessionPersistenceDisabled: isSessionPersistenceDisabled(),
        commentMonitor,
      }),
    }
  }
  const afterLue = activeBlocker()
  if (afterLue !== undefined) {
    logUpdateRefused({
      active_tasks: afterLue.activeTasks,
      comment_monitor: afterLue.kind === 'comment_monitor',
      deferred: true,
    })
    return {
      type: 'text',
      value: formatUpdateActiveTaskRefuseMessage(afterLue),
    }
  }

  const s5 = await prepareBridgeSkipArchive(context.setAppState)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { transcriptHasBytes } =
      require('../../utils/sessionStorage.js') as typeof import('../../utils/sessionStorage.js')
    const hasNonEmptyTranscript = await transcriptHasBytes()
    const version =
      typeof MACRO !== 'undefined' && typeof MACRO.VERSION === 'string'
        ? MACRO.VERSION
        : 'this build'
    // official extraArgs A=[...o5(w,wle(t)),...i5(w,AL())]
    // leftover Cmt+Rmt via toolPermissionContext → buildTuiRelaunchExtraArgs
    // official env m = team + $B() + s5; not TUI_JUST_SWITCHED / not Yk
    // official ha() skips team env when leftover isTeammate()
    const extraInjectEnv: Record<string, string> = { ...s5 }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isAssistantTeamEnvSkipped } =
        require('../../utils/sessionRelaunchSnapshot.js') as typeof import('../../utils/sessionRelaunchSnapshot.js')
      const teamName = appState.teamContext?.teamName
      if (teamName && !isAssistantTeamEnvSkipped()) {
        extraInjectEnv.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME = teamName
      }
    } catch {
      const teamName = appState.teamContext?.teamName
      if (teamName) {
        extraInjectEnv.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME = teamName
      }
    }
    // official zL(t.messages,"relaunch",{},t.storageV5)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { snapshotSessionForRelaunch, withRelaunchKet } =
      require('../../utils/sessionRelaunchSnapshot.js') as typeof import('../../utils/sessionRelaunchSnapshot.js')
    const persist = await snapshotSessionForRelaunch(
      context.messages ?? [],
      'relaunch',
      {},
      context.storageV5,
    )
    const result = await withRelaunchKet(persist, () =>
      acceptTuiRelaunch({
        target: 'default',
        sessionId: getSessionId(),
        hasNonEmptyTranscript,
        toolPermissionContext: ctx,
        effort: appState.effortValue,
        injectTuiSwitch: false,
        extraInjectEnv,
        proactivity: {
          proactivityLevel:
            context.getProactivityLevel?.() ?? appState.proactivityLevel,
          toolPermissionContext: ctx,
        },
        preSpawn: () => {
          // official `_G` e.preSpawn after leftover ja/mEe/$ie
          // chalk v5 default export typing has no `.dim` on `typeof import('chalk')`
          process.stdout.write(
            `\nSwitching from ${version} to latest\u2026 conversation will continue\n`,
          )
        },
      }),
    )
    if (result.mode === 'spawned' && result.spawn.ok) {
      flushStreamsBeforeRelaunchExit()
      process.exit(result.spawn.status ?? 0)
    }
    if (result.mode === 'spawned' && !result.spawn.ok) {
      return {
        type: 'text',
        value: `Couldn't restart Claude Code \u2014 ${result.spawn.error}`,
      }
    }
    return {
      type: 'text',
      value: 'Restarting on the latest version\u2026',
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return {
      type: 'text',
      value: `Couldn't restart Claude Code \u2014 ${detail}`,
    }
  }
}
