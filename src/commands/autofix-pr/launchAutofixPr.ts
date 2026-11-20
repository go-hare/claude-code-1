// NOTE: subscribePR (KAIROS_GITHUB_WEBHOOKS feature) is omitted here.
// The kairos client is not fully available in this repo. The feature-gated
// call is a nice-to-have and safe to skip — teleport + registerRemoteAgentTask
// is sufficient for the core autofix flow.

import React from 'react'
import { feature } from 'bun:bundle'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  checkRemoteAgentEligibility,
  formatPreconditionError,
  getRemoteTaskSessionUrl,
  registerCompletionChecker,
  registerCompletionHook,
  registerContentExtractor,
  registerRemoteAgentTask,
  type AutofixPrRemoteTaskMetadata,
  type BackgroundRemoteSessionPrecondition,
} from '../../tasks/RemoteAgentTask/RemoteAgentTask.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { detectCurrentRepositoryWithHost } from '../../utils/detectRepository.js'
import { archiveRemoteSession, teleportToRemote } from '../../utils/teleport.js'
import {
  type AutofixPhase,
  AutofixProgress,
  formatAutofixCancelMessage,
  formatAutofixStopFailedMessage,
} from './AutofixProgress.js'
import { createAutofixTeammate } from './inProcessAgent.js'
import {
  clearActiveMonitor,
  getActiveMonitor,
  isMonitoring,
  trySetActiveMonitor,
  updateActiveMonitor,
} from './monitorState.js'
import { extractAutofixResultFromLog } from './extractAutofixResult.js'
import { parseAutofixArgs } from './parseArgs.js'
import { checkPrAutofixOutcome, fetchPrHeadSha } from './prFetch.js'
import { detectAutofixSkills, formatSkillsHint } from './skillDetect.js'

// Throttle map for the completionChecker: gh CLI is called at most once per
// PR per CHECK_INTERVAL_MS, regardless of the framework's 1s poll cadence.
// Key is `${owner}/${repo}#${prNumber}`. Cleared when the completion hook
// fires so a re-launched monitor starts with a fresh budget.
const lastCheckAt = new Map<string, number>()
const CHECK_INTERVAL_MS = 5_000

function throttleKey(meta: AutofixPrRemoteTaskMetadata): string {
  return `${meta.owner}/${meta.repo}#${meta.prNumber}`
}

// Register the completionChecker once at module load. The framework calls it
// on every poll tick for tasks with remoteTaskType==='autofix-pr'; throttle
// inside so we don't fire gh CLI 60×/min. Returns the summary string on
// completion (becomes the task-notification body) or null to keep polling.
registerCompletionChecker('autofix-pr', async metadata => {
  const meta = metadata as AutofixPrRemoteTaskMetadata | undefined
  if (!meta) return null

  const key = throttleKey(meta)
  const now = Date.now()
  if (now - (lastCheckAt.get(key) ?? 0) < CHECK_INTERVAL_MS) return null
  lastCheckAt.set(key, now)

  const result = await checkPrAutofixOutcome({
    owner: meta.owner,
    repo: meta.repo,
    prNumber: meta.prNumber,
    initialHeadSha: meta.initialHeadSha,
  })
  return result.completed ? result.summary : null
})

// Release the singleton monitor lock when the framework transitions the
// autofix task to a terminal state. Without this, the lock — keyed by the
// framework-assigned taskId (after callAutofixPr's updateActiveMonitor swap)
// — would dangle past natural completion, blocking subsequent /autofix-pr
// invocations until the process restarts. Registered at module load; the
// framework's runCompletionHook invokes it once per terminal transition.
// Also clear the per-PR throttle entry so a re-launch starts fresh.
registerCompletionHook('autofix-pr', (taskId, metadata) => {
  clearActiveMonitor(taskId)
  const meta = metadata as AutofixPrRemoteTaskMetadata | undefined
  if (meta) lastCheckAt.delete(throttleKey(meta))
})

// Phase 3 content return: extract the <autofix-result> tag from the session
// log so the local model sees the agent's structured outcome (commits
// pushed, files changed, CI status) inline in the completion task-
// notification — instead of just a file-path pointer. The framework falls
// back to the generic notification if extraction returns null.
registerContentExtractor('autofix-pr', log => extractAutofixResultFromLog(log))

function makeErrorText(message: string, code: string): string {
  logEvent('tengu_autofix_pr_result', {
    result:
      'failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return `Autofix PR failed: ${message}`
}

/**
 * Official 2.1.327 (#447) `ke`: non-blocking Esc cancellation coordinator for
 * `/autofix-pr`. Pressing Esc closes the dialog immediately via `onDone` and
 * aborts the launch signal; if stopping a cloud session that already started
 * fails in the background, `onLateStopFailure` is invoked afterwards with the
 * session link so the user can stop it themselves.
 */
export function createAutofixCancelController(opts: {
  onDone: (message: string, options?: { display?: 'system' }) => void
  onLateStopFailure?: (message: string) => void
  stopSession?: (sessionId: string) => Promise<boolean>
}): {
  signal: AbortSignal
  setPhase: (phase: AutofixPhase) => void
  setStartedSessionId: (sessionId: string) => void
  cancelNow: () => void
  reportLateStopIfNeeded: (sessionId: string) => Promise<string | null>
  isCancelled: () => boolean
} {
  const abortController = new AbortController()
  let currentPhase: AutofixPhase = 'detecting'
  let startedSessionId: string | null = null
  let doneCalled = false

  const stopSessionFn = opts.stopSession ?? archiveRemoteSession

  const reportLateStopIfNeeded = async (
    sessionId: string,
  ): Promise<string | null> => {
    let stopped = false
    try {
      stopped = await stopSessionFn(sessionId)
    } catch {
      stopped = false
    }
    if (stopped) return null
    const msg = formatAutofixStopFailedMessage(
      getRemoteTaskSessionUrl(sessionId),
    )
    opts.onLateStopFailure?.(msg)
    return msg
  }

  return {
    signal: abortController.signal,
    setPhase(phase: AutofixPhase) {
      currentPhase = phase
    },
    setStartedSessionId(sessionId: string) {
      startedSessionId = sessionId
    },
    cancelNow() {
      if (doneCalled) return
      doneCalled = true
      abortController.abort()
      // Close the dialog at once — never hold the keyboard while stopping!
      opts.onDone(formatAutofixCancelMessage(currentPhase), {
        display: 'system',
      })
      if (startedSessionId) {
        void reportLateStopIfNeeded(startedSessionId)
      }
    },
    reportLateStopIfNeeded,
    isCancelled() {
      return abortController.signal.aborted
    },
  }
}

type AutofixStartParsed = Extract<
  ReturnType<typeof parseAutofixArgs>,
  { action: 'start' }
>

function wireLateStopFailure(
  context: Parameters<LocalJSXCommandCall>[1],
): (message: string) => void {
  return (message: string) => {
    context.addNotification?.({
      key: 'autofix-pr-stop-failed',
      kind: 'warning',
      text: message,
      color: 'warning',
      priority: 'high',
    })
  }
}

async function runAutofixPrLaunch({
  parsed,
  onDone,
  context,
  cancelController,
  onPhaseChange,
  onTargetChange,
  onComplete,
  onError,
}: {
  parsed: AutofixStartParsed
  onDone: Parameters<LocalJSXCommandCall>[0]
  context: Parameters<LocalJSXCommandCall>[1]
  cancelController: ReturnType<typeof createAutofixCancelController>
  onPhaseChange?: (phase: AutofixPhase) => void
  onTargetChange?: (target: string) => void
  onComplete?: (info: { target: string; sessionUrl: string }) => void
  onError?: (message: string) => void
}): Promise<{ target: string; sessionUrl: string } | null> {
  const setPhase = (phase: AutofixPhase): void => {
    cancelController.setPhase(phase)
    onPhaseChange?.(phase)
  }

  try {
    setPhase('detecting')

    // 4.1 resolve owner/repo. Always detect cwd repo first because teleport
    // takes the git source from the working directory; cross-repo args that
    // don't match cwd would silently work on the wrong repo.
    let detected: { host: string; owner: string; name: string } | null
    try {
      detected = await detectCurrentRepositoryWithHost()
    } catch {
      if (cancelController.isCancelled()) return null
      const msg = makeErrorText(
        'Cannot detect GitHub repo from current directory.',
        'session_create_failed',
      )
      setPhase('error')
      onError?.(msg)
      onDone(msg, { display: 'system' })
      return null
    }
    if (cancelController.isCancelled()) return null
    if (!detected || detected.host !== 'github.com') {
      const msg = makeErrorText(
        'Cannot detect GitHub repo from current directory.',
        'session_create_failed',
      )
      setPhase('error')
      onError?.(msg)
      onDone(msg, { display: 'system' })
      return null
    }

    // Cross-repo args (owner/repo#n) must match the current working directory;
    // teleport's git source is taken from cwd, so a mismatch would create a
    // session against the wrong repo. Accept both as a safety check rather
    // than as a real cross-repo capability — true cross-repo support requires
    // a separate clone path not yet implemented here.
    if (
      (parsed.owner && parsed.owner !== detected.owner) ||
      (parsed.repo && parsed.repo !== detected.name)
    ) {
      const msg = makeErrorText(
        `Cross-repo autofix is not supported from this directory. Run from ${detected.owner}/${detected.name} or pass only the PR number.`,
        'repo_mismatch',
      )
      setPhase('error')
      onError?.(msg)
      onDone(msg, { display: 'system' })
      return null
    }
    const owner = detected.owner
    const repo = detected.name
    const { prNumber } = parsed
    const target = `${owner}/${repo}#${prNumber}`
    onTargetChange?.(target)

    // 4.2 singleton lock — already monitoring this exact PR
    if (isMonitoring(owner, repo, prNumber)) {
      logEvent('tengu_autofix_pr_result', {
        result:
          'success_rc' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      onDone(`Already monitoring ${repo}#${prNumber} in background.`, {
        display: 'system',
      })
      return null
    }

    // 4.3 eligibility check (tolerate no_remote_environment, surface real reasons).
    // skipBundle:true matches the teleport call below — autofix needs to push
    // back to GitHub, which a git bundle cannot do.
    setPhase('checking_eligibility')
    const eligibility = await checkRemoteAgentEligibility({ skipBundle: true })
    if (cancelController.isCancelled()) return null
    if (!eligibility.eligible) {
      const blockers = eligibility.errors.filter(
        (e: BackgroundRemoteSessionPrecondition) =>
          e.type !== 'no_remote_environment',
      )
      if (blockers.length > 0) {
        const reasons = blockers.map(formatPreconditionError).join('\n')
        const msg = makeErrorText(
          `Remote agent not available:\n${reasons}`,
          'session_create_failed',
        )
        setPhase('error')
        onError?.(msg)
        onDone(msg, { display: 'system' })
        return null
      }
    }

    // 4.4 detect skills
    const skills = detectAutofixSkills(process.cwd())
    const skillsHint = formatSkillsHint(skills)

    // 4.5 compose message
    const branchName = `refs/pull/${prNumber}/head`
    const initialMessage = `Auto-fix failing CI checks on PR #${prNumber} in ${owner}/${repo}.${skillsHint}

When you finish (or hit a blocker you can't recover from), output the following XML tag as your final message so the local user gets a structured summary:

<autofix-result>
  <pr-number>${prNumber}</pr-number>
  <commits-pushed>
    <commit sha="...">commit message</commit>
  </commits-pushed>
  <files-changed>
    <file path="...">N changes</file>
  </files-changed>
  <ci-status>green | red | pending | unknown</ci-status>
  <summary>One-sentence summary of what was fixed or why it could not be fixed.</summary>
</autofix-result>

If no fix was needed, omit <commits-pushed> and <files-changed> and explain in <summary>. If you only attempted partial work, list the commits you did push and explain the remainder in <summary>.`

    // 4.6 in-process teammate
    const teammate = createAutofixTeammate(initialMessage, target)
    cancelController.signal.addEventListener(
      'abort',
      () => teammate.abortController.abort(),
      { once: true },
    )

    // 4.7 acquire lock atomically BEFORE doing any awaits. This closes the
    // TOCTOU race where two concurrent invocations both see active=null and
    // both try to create remote sessions.
    setPhase('acquiring_lock')
    const lockAcquired = trySetActiveMonitor({
      taskId: teammate.taskId,
      owner,
      repo,
      prNumber,
      abortController: teammate.abortController,
      startedAt: Date.now(),
    })
    if (!lockAcquired) {
      const existing = getActiveMonitor()
      const msg = makeErrorText(
        `already monitoring ${existing?.repo}#${existing?.prNumber}. Run /autofix-pr stop first.`,
        'rc_already_monitoring_other',
      )
      setPhase('error')
      onError?.(msg)
      onDone(msg, { display: 'system' })
      return null
    }

    // 4.8 teleport — wire BOTH onBundleFail and onCreateFail so HTTP-layer
    // failures (4xx/5xx, expired token, invalid PR ref) reach the user with
    // the upstream message instead of the generic fallback.
    let teleportFailMsg: string | undefined
    const captureFailMsg = (msg: string) => {
      teleportFailMsg = msg
    }
    let session: { id: string; title: string } | null = null
    setPhase('launching')
    try {
      session = await teleportToRemote({
        initialMessage,
        source: 'autofix_pr',
        branchName,
        skipBundle: true,
        title: `Autofix PR: ${target}`,
        useDefaultEnvironment: true,
        signal: teammate.abortController.signal,
        githubPr: { owner, repo, number: prNumber },
        onBundleFail: captureFailMsg,
        onCreateFail: captureFailMsg,
      })
    } catch (teleErr: unknown) {
      clearActiveMonitor(teammate.taskId)
      if (cancelController.isCancelled()) return null
      const teleMsg =
        teleErr instanceof Error ? teleErr.message : String(teleErr)
      const msg = makeErrorText(
        `teleport failed: ${teleMsg}`,
        'teleport_failed',
      )
      setPhase('error')
      onError?.(msg)
      onDone(msg, { display: 'system' })
      return null
    }

    if (!session) {
      clearActiveMonitor(teammate.taskId)
      if (cancelController.isCancelled()) return null
      const msg = makeErrorText(
        teleportFailMsg ?? 'remote session creation failed.',
        'session_create_failed',
      )
      setPhase('error')
      onError?.(msg)
      onDone(msg, { display: 'system' })
      return null
    }

    cancelController.setStartedSessionId(session.id)
    if (cancelController.isCancelled()) {
      clearActiveMonitor(teammate.taskId)
      void cancelController.reportLateStopIfNeeded(session.id)
      return null
    }

    // 4.8b capture PR head SHA before registering so the completionChecker
    // can detect when the agent has pushed new commits.
    const initialHeadSha =
      (await fetchPrHeadSha(owner, repo, prNumber).catch(() => null)) ??
      undefined
    if (cancelController.isCancelled()) {
      clearActiveMonitor(teammate.taskId)
      void cancelController.reportLateStopIfNeeded(session.id)
      return null
    }

    // 4.9 register task. If this throws, release the lock so the user can retry.
    try {
      const { taskId: frameworkTaskId } = registerRemoteAgentTask({
        remoteTaskType: 'autofix-pr',
        session,
        command: `/autofix-pr ${prNumber}`,
        context,
        isLongRunning: true,
        remoteTaskMetadata: { owner, repo, prNumber, initialHeadSha },
      })
      updateActiveMonitor({ taskId: frameworkTaskId, sessionId: session.id })
    } catch (regErr: unknown) {
      clearActiveMonitor(teammate.taskId)
      if (cancelController.isCancelled()) return null
      const regMsg = regErr instanceof Error ? regErr.message : String(regErr)
      let stopFailureNote = ''
      try {
        const stopped = await archiveRemoteSession(session.id)
        if (!stopped) {
          stopFailureNote = ` A cloud session had already started and Claude Code couldn't stop it, so it may still work on the PR. Stop it here: ${getRemoteTaskSessionUrl(session.id)}`
        }
      } catch {
        stopFailureNote = ` A cloud session had already started and Claude Code couldn't stop it, so it may still work on the PR. Stop it here: ${getRemoteTaskSessionUrl(session.id)}`
      }
      const msg = makeErrorText(
        `task registration failed: ${regMsg}.${stopFailureNote}`,
        'registration_failed',
      )
      setPhase('error')
      onError?.(msg)
      onDone(msg, { display: 'system' })
      return null
    }

    // 4.10 PR webhook subscription (feature-gated, non-fatal)
    if (feature('KAIROS_GITHUB_WEBHOOKS')) {
      // kairos client not available in this repo — skip silently
    }

    // 4.11 success
    setPhase('done')
    const sessionUrl = getRemoteTaskSessionUrl(session.id)
    logEvent('tengu_autofix_pr_result', {
      result:
        'success_rc' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    onComplete?.({ target, sessionUrl })
    onDone(`Autofix launched for ${target}. Track: ${sessionUrl}`, {
      display: 'system',
    })
    return { target, sessionUrl }
  } catch (err: unknown) {
    if (cancelController.isCancelled()) return null
    const msg = err instanceof Error ? err.message : String(err)
    logEvent('tengu_autofix_pr_result', {
      result:
        'failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'exception' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    setPhase('error')
    onError?.(`Autofix PR failed: ${msg}`)
    onDone(`Autofix PR failed: ${msg}`, { display: 'system' })
    return null
  }
}

/**
 * Official 2.1.327 (#447): stateful launcher returned immediately from
 * `callAutofixPr` in interactive REPL sessions so `<AutofixProgress>` is
 * mounted while the async launch pipeline runs and Esc cancels immediately.
 */
export function AutofixLauncher({
  parsed,
  onDone,
  context,
}: {
  parsed: AutofixStartParsed
  onDone: Parameters<LocalJSXCommandCall>[0]
  context: Parameters<LocalJSXCommandCall>[1]
}): React.ReactElement {
  const initialTarget =
    parsed.owner && parsed.repo
      ? `${parsed.owner}/${parsed.repo}#${parsed.prNumber}`
      : `#${parsed.prNumber}`
  const [phase, setPhase] = React.useState<AutofixPhase>('detecting')
  const [target, setTarget] = React.useState(initialTarget)
  const [sessionUrl, setSessionUrl] = React.useState<string | undefined>(
    undefined,
  )
  const [errorMessage, setErrorMessage] = React.useState<string | undefined>(
    undefined,
  )

  const cancelControllerRef = React.useRef<ReturnType<
    typeof createAutofixCancelController
  > | null>(null)
  if (cancelControllerRef.current === null) {
    cancelControllerRef.current = createAutofixCancelController({
      onDone,
      stopSession: archiveRemoteSession,
      onLateStopFailure: wireLateStopFailure(context),
    })
  }
  const cancelController = cancelControllerRef.current

  React.useEffect(() => {
    void runAutofixPrLaunch({
      parsed,
      onDone,
      context,
      cancelController,
      onPhaseChange: setPhase,
      onTargetChange: setTarget,
      onComplete: info => {
        setTarget(info.target)
        setSessionUrl(info.sessionUrl)
      },
      onError: setErrorMessage,
    })
  }, [parsed, onDone, context, cancelController])

  return React.createElement(AutofixProgress, {
    phase,
    target,
    sessionUrl,
    errorMessage,
    onCancel: cancelController.cancelNow,
  })
}

export const callAutofixPr: LocalJSXCommandCall = async (
  onDone,
  context,
  args,
) => {
  try {
    const parsed = parseAutofixArgs(args)

    // 1. stop sub-command
    if (parsed.action === 'stop') {
      const m = getActiveMonitor()
      if (!m) {
        onDone('No active autofix monitor.', { display: 'system' })
        return null
      }
      clearActiveMonitor()
      // Official 2.1.326 #101: try to stop the remote cloud session before
      // claiming cancellation; if stopping fails, link the session so the user
      // can stop it themselves.
      if (m.sessionId) {
        let stopped = false
        try {
          stopped = await archiveRemoteSession(m.sessionId)
        } catch {
          stopped = false
        }
        if (stopped) {
          onDone(
            `Stopped autofix monitor and cloud session for ${m.repo}#${m.prNumber}.`,
            {
              display: 'system',
            },
          )
          return null
        }
        const sessionUrl = getRemoteTaskSessionUrl(m.sessionId)
        onDone(
          `A cloud session had already started and Claude Code couldn't stop it, so it may still work on the PR. Stop it here: ${sessionUrl}`,
          { display: 'system' },
        )
        return null
      }
      onDone(`Stopped local monitoring of ${m.repo}#${m.prNumber}.`, {
        display: 'system',
      })
      return null
    }

    // 2. invalid
    if (parsed.action === 'invalid') {
      onDone(
        `Invalid args: ${parsed.reason}. Use /autofix-pr <pr-number> | stop | <owner>/<repo>#<n>`,
        {
          display: 'system',
        },
      )
      return null
    }

    // 3. freeform — not yet supported
    if (parsed.action === 'freeform') {
      onDone(
        'Freeform prompt mode not yet supported. Use /autofix-pr <pr-number>.',
        {
          display: 'system',
        },
      )
      return null
    }

    // 4. start. has_repo_path tracks whether the user supplied an explicit
    // owner/repo via cross-repo syntax (vs relying on directory detection).
    logEvent('tengu_autofix_pr_started', {
      action:
        'start' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      has_pr_number:
        'true' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      has_repo_path: String(
        !!(parsed.owner && parsed.repo),
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    // Official 2.1.327 (#447): in interactive REPL sessions, return a stateful
    // <AutofixLauncher> immediately so <AutofixProgress> mounts live and Esc
    // cancels immediately without waiting for network calls to finish.
    if (context?.options && !context.options.isNonInteractiveSession) {
      return React.createElement(AutofixLauncher, {
        parsed,
        onDone,
        context,
      })
    }

    const cancelController = createAutofixCancelController({
      onDone,
      stopSession: archiveRemoteSession,
      onLateStopFailure: wireLateStopFailure(context),
    })
    const completed = await runAutofixPrLaunch({
      parsed,
      onDone,
      context,
      cancelController,
    })
    if (!completed) return null
    return React.createElement(AutofixProgress, {
      phase: 'done',
      target: completed.target,
      sessionUrl: completed.sessionUrl,
      onCancel: cancelController.cancelNow,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logEvent('tengu_autofix_pr_result', {
      result:
        'failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        'exception' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    onDone(`Autofix PR failed: ${msg}`, { display: 'system' })
    return null
  }
}
