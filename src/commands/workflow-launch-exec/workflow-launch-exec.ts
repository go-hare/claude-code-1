import type { LocalCommandCall } from '../../types/command.js'
import { logForDebugging } from '../../utils/debug.js'
import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js'
import { runRemoteWorkflowScript } from '../remote-workflow/remoteWorkflowRunner.js'

export type WorkflowLaunchHandoff = {
  script: string
  args?: unknown
  eventSessionOrigin?: string
  onRunSettled: (ok: boolean) => void | Promise<void>
  postResultLine: (line: string) => void
}

const pendingHandoffsHostSlot = new HostSlot<
  Map<string, WorkflowLaunchHandoff>
>(() => new Map())

export function registerWorkflowLaunchHandoff(
  token: string,
  handoff: WorkflowLaunchHandoff,
): void {
  pendingHandoffsHostSlot.of(getBootstrapSessionHost()).set(token, handoff)
}

export function takeWorkflowLaunchHandoff(
  token: string,
): WorkflowLaunchHandoff | undefined {
  const pendingHandoffs = pendingHandoffsHostSlot.of(getBootstrapSessionHost())
  const entry = pendingHandoffs.get(token)
  if (entry !== undefined) {
    pendingHandoffs.delete(token)
  }
  return entry
}

export function clearWorkflowLaunchHandoffsForTests(): void {
  pendingHandoffsHostSlot.of(getBootstrapSessionHost()).clear()
}

export const NO_PENDING_HANDOFF_MESSAGE =
  'workflow-launch-exec: no pending launch handoff for this invocation (expected when a restored session replays the dispatch turn); nothing executed.'

/**
 * Official 2.1.331 `chunk-xch8y6bq.js` — `/workflow-launch-exec` handler.
 */
export const call: LocalCommandCall = async (args, context) => {
  const token = args.trim()
  const handoff = token ? takeWorkflowLaunchHandoff(token) : undefined

  if (!handoff) {
    logForDebugging('workflow_launch_exec_no_slot')
    return {
      type: 'text',
      value: NO_PENDING_HANDOFF_MESSAGE,
    }
  }

  const outcome = await runRemoteWorkflowScript({
    script: handoff.script,
    args: handoff.args,
    telemetrySource: 'remote_event',
    serverAuthoredCarrier: true,
    eventSessionOrigin: handoff.eventSessionOrigin,
    context,
  })

  try {
    await handoff.onRunSettled(outcome.ok)
  } catch {
    logForDebugging('workflow_launch_settle_failed', { level: 'warn' })
  }

  try {
    handoff.postResultLine(outcome.line)
  } catch {
    logForDebugging('workflow_launch_result_post_failed', { level: 'warn' })
  }

  return { type: 'text', value: outcome.line }
}
