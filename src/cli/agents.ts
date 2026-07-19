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
    } else if (PASSTHROUGH_FLAGS.some(f => arg.startsWith(f))) {
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
  await renderAgentView({
    dispatchExtraArgs,
    cwdFilter,
    restoreSessionId: restoreSessionId || undefined,
    enteredViaLeftArrow,
    // agentsMain already ensured daemon + owns bgManager.close()
    daemonAlreadyEnsured: true,
  })

  // Cleanup bg manager on exit (only if we started one)
  if (bgManager) {
    await bgManager.close()
  }
}
