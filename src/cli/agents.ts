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

import type { SessionEntry } from './bg/engine.js'

export interface AgentViewAction {
  type: 'attach' | 'create' | 'kill' | 'done'
  sessionId?: string
  prompt?: string
}

// Flags that get forwarded to dispatched sessions
const PASSTHROUGH_FLAGS = [
  '--add-dir',
  '--settings',
  '--mcp-config',
  '--plugin-dir',
  '--permission-mode',
  '--model',
  '--effort',
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--fallback-model',
  '--strict-mcp-config',
]

/**
 * densable YBn soft-parse for --effort on agents dispatch path.
 * agentsMain forwards raw argv (commander parse result is discarded), so we
 * re-apply the same soft-warn + drop-unknown as main CLI here.
 */
function rewriteEffortPassthrough(flag: string, rawValue: string): string[] {
  // Lazy require: agents entry stays light until effort is actually used.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { parseCliEffortArg } =
    require('../utils/effort.js') as typeof import('../utils/effort.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const { level, warning } = parseCliEffortArg(rawValue)
  if (warning !== undefined) {
    // densable YBn: soft-warn on stderr with trailing newline
    process.stderr.write(`Warning: ${warning}\n`)
  }
  if (level === undefined) return []
  // Normalize med → medium / keep ultracode alias for child process.
  if (flag.includes('=')) return [`--effort=${level}`]
  return ['--effort', level]
}

function extractPassthroughArgs(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (
      arg === '--dangerously-skip-permissions' ||
      arg === '--allow-dangerously-skip-permissions' ||
      arg === '--strict-mcp-config'
    ) {
      result.push(arg)
      continue
    }

    // densable YBn: soft-parse --effort / --effort=… before generic passthrough.
    if (arg === '--effort' || arg.startsWith('--effort=')) {
      let rawValue: string | undefined
      if (arg.startsWith('--effort=')) {
        rawValue = arg.slice('--effort='.length)
        result.push(...rewriteEffortPassthrough(arg, rawValue))
      } else if (i + 1 < args.length && !args[i + 1]!.startsWith('--')) {
        rawValue = args[++i]!
        result.push(...rewriteEffortPassthrough('--effort', rawValue))
      }
      // bare --effort with no value → drop
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
    const { listAllJobs } = await import('../daemon/jobState.js')
    const jobs = await listAllJobs()
    const sessions: SessionEntry[] = jobs.map(({ short, state: job }) => {
      const createdMs = Date.parse(job.createdAt)
      const updatedMs = Date.parse(job.updatedAt)
      return {
        pid: job.pid ?? 0,
        sessionId: job.sessionId,
        short,
        cwd: job.cwd,
        startedAt: Number.isFinite(createdMs) ? createdMs : Date.now(),
        kind: 'bg',
        name: job.name,
        status:
          job.state === 'working'
            ? job.tempo === 'blocked'
              ? 'waiting'
              : 'busy'
            : job.state === 'blocked'
              ? 'waiting'
              : job.state,
        updatedAt: Number.isFinite(updatedMs) ? updatedMs : Date.now(),
        engine: 'detached',
        lastMessage: job.detail || undefined,
        waitingFor:
          job.needs || job.block?.questions?.[0]?.question || undefined,
        pinned: job.pinned,
        gitBranch: job.worktreeBranch,
        group: job.group,
        archived: job.archived,
        sortOrder: job.sortOrder,
        agent: job.agent,
      }
    })
    process.stdout.write(JSON.stringify(sessions, null, 2) + '\n')
    return
  }

  // --cwd <path>: scope session list to a directory
  let cwdFilter: string | undefined
  const cwdIdx = args.indexOf('--cwd')
  if (cwdIdx >= 0 && cwdIdx + 1 < args.length) {
    cwdFilter = args[cwdIdx + 1]
  }

  // Extract passthrough args for dispatched sessions
  const dispatchExtraArgs = extractPassthroughArgs(args)

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

  // Interactive dashboard
  const { renderAgentView } = await import('../screens/AgentView.js')
  try {
    await renderAgentView({
      dispatchExtraArgs,
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
