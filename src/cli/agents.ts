/**
 * `claude agents` — Agent view entry point.
 * Lists all background sessions in a full-screen interactive dashboard.
 *
 * Accepts flags that are forwarded to dispatched background sessions:
 *   --add-dir, --settings, --mcp-config, --plugin-dir
 *   --permission-mode, --model, --effort
 *   --dangerously-skip-permissions
 *   --cwd <path>  (scope session list to a directory)
 *   --json         (output session list as JSON and exit)
 */

import { realpath } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'
import type { BgJobState } from '../daemon/jobState.js'

export interface AgentViewAction {
  type: 'attach' | 'create' | 'kill' | 'done'
  sessionId?: string
  prompt?: string
}

function normalizeAgentJsonStatus(status: string): 'idle' | 'waiting' | 'busy' {
  return status === 'idle' ? 'idle' : status === 'waiting' ? 'waiting' : 'busy'
}

function deriveAgentJsonState(
  job: BgJobState,
  liveStatus: string | undefined,
  hasBlockingInFlightFn: (state: BgJobState) => boolean,
): 'working' | 'blocked' | 'done' | 'failed' | 'stopped' {
  if (liveStatus === 'busy') return 'working'
  const rawState = job.state as string
  const isSuccess = rawState === 'done' || rawState === 'success'
  const isFailure =
    rawState === 'failed' || rawState === 'failure' || rawState === 'crashed'
  const isTerminal = isSuccess || isFailure || rawState === 'stopped'
  if (isTerminal && !(isSuccess && hasBlockingInFlightFn(job))) {
    return isSuccess ? 'done' : isFailure ? 'failed' : 'stopped'
  }
  if (job.tempo === 'blocked' || liveStatus === 'waiting') return 'blocked'
  return 'working'
}

export async function printAgentsJson(
  cwdFilter?: string,
  includeAll?: boolean,
): Promise<void> {
  const resolvedFilter = cwdFilter
    ? await realpath(resolve(cwdFilter)).catch(() => resolve(cwdFilter))
    : undefined
  const matchesCwd = (target: string | undefined): boolean => {
    if (!resolvedFilter) return true
    if (!target) return false
    const rel = relative(resolvedFilter, target)
    return rel.split(/[/\\]/, 1)[0] !== '..' && !isAbsolute(rel)
  }

  const [{ listAllJobs, hasBlockingInFlight }, { listAllLiveSessions }] =
    await Promise.all([
      import('../daemon/jobState.js'),
      import('../utils/udsClient.js'),
    ])
  const [liveSessions, jobs] = await Promise.all([
    listAllLiveSessions().catch(() => []),
    listAllJobs(),
  ])

  const bgByJobId = new Map<string, (typeof liveSessions)[number]>()
  for (const s of liveSessions) {
    if (s.kind === 'bg' && s.jobId) {
      bgByJobId.set(s.jobId, s)
    }
  }

  const out: Array<Record<string, unknown>> = []
  const seenPids = new Set<number>()

  for (const { short, state: job } of jobs) {
    if (job.archived) continue
    const live = bgByJobId.get(short)
    if (live) seenPids.add(live.pid)
    if (!matchesCwd(job.originCwd ?? job.cwd)) continue
    const state = deriveAgentJsonState(job, live?.status, hasBlockingInFlight)
    if (!includeAll && !live && state !== 'working' && state !== 'blocked') {
      continue
    }
    const rawName =
      live?.name ??
      job.name ??
      (job as { displayIntent?: string }).displayIntent ??
      job.intent
    const name = rawName?.replace(/\s+/g, ' ').trim() || undefined
    const createdMs = Date.parse(job.createdAt)
    out.push({
      ...(live ? { pid: live.pid } : {}),
      id: short,
      cwd: live?.cwd ?? job.cwd,
      kind: 'background',
      startedAt:
        live?.startedAt ?? (Number.isFinite(createdMs) ? createdMs : 0),
      sessionId: live?.sessionId ?? job.sessionId,
      ...(name ? { name } : {}),
      ...(live?.status
        ? { status: normalizeAgentJsonStatus(live.status) }
        : {}),
      ...(live?.status === 'waiting' && live.waitingFor
        ? { waitingFor: live.waitingFor }
        : {}),
      state,
    })
  }

  for (const s of liveSessions) {
    if ((s.kind !== 'interactive' && s.kind !== 'bg') || seenPids.has(s.pid)) {
      continue
    }
    if (s.kind === 'bg' && s.jobId) continue
    if (s.parkedJobId !== undefined) continue
    if (!matchesCwd(s.cwd)) continue
    const name = s.name?.replace(/\s+/g, ' ').trim() || undefined
    out.push({
      pid: s.pid,
      cwd: s.cwd,
      kind: s.kind === 'bg' ? 'background' : 'interactive',
      startedAt: s.startedAt ?? 0,
      ...(s.sessionId ? { sessionId: s.sessionId } : {}),
      ...(name ? { name } : {}),
      ...(s.status ? { status: normalizeAgentJsonStatus(s.status) } : {}),
      ...(s.status === 'waiting' && s.waitingFor
        ? { waitingFor: s.waitingFor }
        : {}),
    })
  }

  out.sort((a, b) => Number(a.startedAt ?? 0) - Number(b.startedAt ?? 0))
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
}

// Flags that get forwarded to dispatched sessions.
// densable 2.1.289: permission/model/effort/agent/allow-bypass live on the
// dispatchDefaults bag (parseAgentsDispatchArgv) — not raw passthrough.
const PASSTHROUGH_FLAGS = [
  '--add-dir',
  '--settings',
  '--mcp-config',
  '--plugin-dir',
  '--fallback-model',
  '--strict-mcp-config',
  '--restricted',
]

function extractPassthroughArgs(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--strict-mcp-config' || arg === '--restricted') {
      result.push(arg)
      continue
    }

    if (PASSTHROUGH_FLAGS.some(f => arg.startsWith(f))) {
      result.push(arg)
      // If it's a flag that takes a value and the value is the next arg
      if (
        !arg.includes('=') &&
        i + 1 < args.length &&
        !args[i + 1]!.startsWith('--')
      ) {
        result.push(args[++i]!)
      }
    }
  }
  return result
}

export async function agentsMain(args: string[]): Promise<void> {
  // --json flag: output job list as JSON (same source as FleetView dashboard)
  if (args.includes('--json')) {
    let cwdFilter: string | undefined
    const cwdIdx = args.indexOf('--cwd')
    if (cwdIdx >= 0 && cwdIdx + 1 < args.length) {
      cwdFilter = args[cwdIdx + 1]
    }
    const includeAll = args.includes('--all') || args.includes('-a')
    await printAgentsJson(cwdFilter, includeAll)
    return
  }

  // densable 2.1.289: soft-parse dispatchDefaults bag (permission/model/effort/…).
  const { parseAgentsDispatchArgv } = await import(
    '../screens/fleetView/fleetDispatchDefaults.js'
  )
  const { dispatchDefaults, rest: afterDefaults } =
    parseAgentsDispatchArgv(args)

  // --cwd <path>: scope session list to a directory
  let cwdFilter: string | undefined
  const cwdIdx = afterDefaults.indexOf('--cwd')
  if (cwdIdx >= 0 && cwdIdx + 1 < afterDefaults.length) {
    cwdFilter = afterDefaults[cwdIdx + 1]
  }

  // Remaining non-defaults flags still passthrough (add-dir, settings, …).
  const dispatchExtraArgs = extractPassthroughArgs(afterDefaults)

  // Official KF / Wy_: ensure daemon with install prompt denser.
  let bgManager: { close(): Promise<void> } | null = null
  {
    const { ensureDaemonRunning } = await import('../daemon/installPrompt.js')
    const daemon = await ensureDaemonRunning()
    if (!daemon.ok) {
      process.stderr.write(
        `${daemon.reason ?? "No background daemon is running. Run 'claude daemon install' to set it up as a persistent service."}\n`,
      )
      return
    }
    bgManager = daemon.manager
  }

  // Official chO / mountFleetView: restore selection from CLAUDE_AGENTS_SELECT
  // (set by GCp attach detach or left-arrow open). Consume once then delete.
  const restoreSessionId = process.env.CLAUDE_AGENTS_SELECT
  const enteredViaLeftArrow = !!restoreSessionId
  delete process.env.CLAUDE_AGENTS_SELECT

  // densable 2.1.225 FXv: await ensureAgentsWorkspaceTrust(root, agentsTrustDecision())
  // before mountFleetView. Short-lived Ink root for TrustDialog only.
  {
    const { createRoot } = await import('../utils/inkRoot.js')
    const { ensureAgentsWorkspaceTrust, agentsTrustDecision } = await import(
      './agentsTrust.js'
    )
    const trustRoot = await createRoot({ exitOnCtrlC: false })
    try {
      await ensureAgentsWorkspaceTrust(trustRoot, agentsTrustDecision())
    } finally {
      try {
        trustRoot.unmount()
      } catch {
        // ignore unmount races on exit path
      }
    }
  }

  // Interactive dashboard
  const { renderAgentView } = await import('../screens/AgentView.js')
  try {
    await renderAgentView({
      dispatchExtraArgs,
      dispatchDefaults,
      cwdFilter,
      restoreSessionId: restoreSessionId || undefined,
      enteredViaLeftArrow,
      // agentsMain already ensured daemon + owns bgManager.close()
      daemonAlreadyEnsured: true,
    })
  } finally {
    // densable agents path does not await a long manager teardown before O7.
    // cap close so Esc→main-buffer is not held black for multi-second socket cleanup.
    if (bgManager) {
      try {
        await Promise.race([
          bgManager.close(),
          new Promise<void>(resolve => {
            const t = setTimeout(resolve, 200)
            t.unref?.()
          }),
        ])
      } catch {
        // ignore close errors on exit path
      }
    }
  }

  // densable agents .action after mountFleetView: await O7(0,"other",{suppressResumeHint:!0})
  // Without this the process can linger on an empty main buffer after unmount
  // (Esc looks like multi-second black screen). Not bun-dev-only — same on build.
  const { gracefulShutdown } = await import('../utils/gracefulShutdown.js')
  await gracefulShutdown(0, 'other', { suppressResumeHint: true })
}
