/**
 * densable doo queueBehind gate:
 * teammate | async agent | forRemoteExecution → queueBehind true.
 * Main-session local → false (become top).
 */
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import {
  getAgentContext,
  isSubagentContext,
  isTeammateAgentContext,
} from '../utils/agentContext.js'

export function shouldQueuePermissionBehind(item: ToolUseConfirm): boolean {
  // Tip swarm worker badge ≈ densable teammate / async worker surface
  if (item.workerBadge != null) return true

  const ctx = item.toolUseContext as {
    forRemoteExecution?: boolean
    agentContext?: { agentType?: string; isAsync?: boolean }
  }
  if (ctx.forRemoteExecution === true) return true

  const nested = ctx.agentContext
  if (nested?.agentType === 'teammate') return true
  if (nested?.isAsync === true) return true

  const als = getAgentContext()
  if (als && isTeammateAgentContext(als)) return true
  if (als && isSubagentContext(als)) {
    // densable dQ(m)&&m.isAsync — tip subagent may carry isAsync on context
    if ((als as { isAsync?: boolean }).isAsync === true) return true
  }

  return false
}
