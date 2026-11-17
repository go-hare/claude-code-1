/**
 * densable 2.1.289 T2t / E2t / e0e / $4n — Stop/SubagentStop hook input extras.
 */
import { getSessionCronTasks } from '../../bootstrap/state.js'
import type { TaskState } from '../../tasks/types.js'
import { isBackgroundTask } from '../../tasks/types.js'

/** densable e0e */
const HOOK_FIELD_CLIP = 1000

const TASK_TYPE_LABEL: Record<string, string> = {
  local_agent: 'subagent',
  local_workflow: 'workflow',
  local_bash: 'shell',
  monitor_mcp: 'monitor',
  monitor_ws: 'monitor',
  mcp_task: 'MCP task',
  in_process_teammate: 'teammate',
  dream: 'dream',
  auto_mode_scan: 'auto-mode scan',
  local_memory_import: 'memory import',
  remote_agent: 'cloud session',
}

export type StopHookBackgroundTask = {
  id: string
  type: string
  status: string
  description: string
  command?: string
  agent_type?: string
  server?: string
  tool?: string
  name?: string
}

export type StopHookSessionCron = {
  id: string
  schedule: string
  recurring: boolean
  prompt: string
}

/** densable nd clip: 1000 chars, append `… [+N chars]`. */
export function clipHookField(
  value: string | undefined,
  max = HOOK_FIELD_CLIP,
): string {
  const text = value ?? ''
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max)}… [+${text.length - max} chars]`
}

function friendlyTaskType(type: string): string {
  return TASK_TYPE_LABEL[type] ?? type
}

/** densable T2t. */
export function snapshotStopBackgroundTasks(
  tasks: Record<string, TaskState> | undefined,
): StopHookBackgroundTask[] {
  const out: StopHookBackgroundTask[] = []
  for (const task of Object.values(tasks ?? {})) {
    if (!isBackgroundTask(task)) {
      continue
    }
    const row: StopHookBackgroundTask = {
      id: task.id,
      type: friendlyTaskType(task.type),
      status: task.status,
      description: clipHookField(task.description),
    }
    switch (task.type) {
      case 'local_bash':
        row.command = clipHookField(task.command)
        break
      case 'local_agent':
        row.agent_type = task.agentType
        break
      case 'monitor_mcp':
        // densable T2t: s.server=r.server, s.tool=r.tool
        row.server = task.server
        row.tool = task.tool
        break
      case 'local_workflow':
        row.name = task.workflowName
        break
      default: {
        // densable T2t mcp_task: s.server=r.serverName, s.tool=r.toolName
        if ((task as { type: string }).type === 'mcp_task') {
          const mcp = task as { serverName?: string; toolName?: string }
          row.server = mcp.serverName
          row.tool = mcp.toolName
        }
        break
      }
    }
    out.push(row)
  }
  return out
}

/** densable E2t. */
export function snapshotStopSessionCrons(): StopHookSessionCron[] {
  return getSessionCronTasks().map(task => ({
    id: task.id,
    schedule: task.cron,
    recurring: task.recurring ?? false,
    prompt: clipHookField(task.prompt),
  }))
}
