/**
 * Coordinator-mode worker agent definition.
 *
 * When COORDINATOR_MODE is active, getBuiltInAgents() returns only
 * the agents from getCoordinatorAgents(). The coordinator's system
 * prompt instructs it to use `subagent_type: "worker"` when spawning
 * tasks via the Agent tool.
 *
 * Workers get the full standard tool set (minus internal orchestration
 * tools like TeamCreate/SendMessage) so they can research, implement,
 * and verify autonomously.
 */
import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import { ASYNC_AGENT_ALLOWED_TOOLS } from '../constants/tools.js'
import { SEND_MESSAGE_TOOL_NAME } from '@claude-code/builtin-tools/tools/SendMessageTool/constants.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@claude-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { TEAM_CREATE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '@claude-code/builtin-tools/tools/TeamDeleteTool/constants.js'
import type { BuiltInAgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { resolveMaxSubagentSpawnDepth } from '../utils/sessionSpawnCaps.js'

/**
 * Tools that workers must NOT have — these are coordinator-only
 * orchestration primitives.
 */
const INTERNAL_ORCHESTRATION_TOOLS = new Set([
  TEAM_CREATE_TOOL_NAME,
  TEAM_DELETE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  SYNTHETIC_OUTPUT_TOOL_NAME,
])

/**
 * Build the worker's allowed tool list from ASYNC_AGENT_ALLOWED_TOOLS,
 * excluding internal orchestration tools.
 */
function getWorkerTools(): string[] {
  // Artifact stays in ASYNC_AGENT_ALLOWED_TOOLS; gold bms `e!==cn||OT()`
  // filters the coordinator prompt list at call time (getCoordinatorUserContext).
  return Array.from(ASYNC_AGENT_ALLOWED_TOOLS).filter(
    name => !INTERNAL_ORCHESTRATION_TOOLS.has(name),
  )
}

const WORKER_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker',
  whenToUse:
    'For executing tasks autonomously — research, implementation, or verification.',
  tools: getWorkerTools(),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () => getWorkerSystemPrompt(),
}

function getWorkerSystemPrompt(): string {
  // densable `nw()>1` — same helper as coordinator bms (session spawn-depth cap).
  // Workers at the depth cap don't receive Agent, so the bullet is omitted.
  const fanOutBullet =
    resolveMaxSubagentSpawnDepth() > 1
      ? `- If you have the ${AGENT_TOOL_NAME} tool, you may use it to fan out (e.g. \`/simplify\`, \`/code-review\`, or your own parallel research/verification) — workers at the depth cap don't receive it\n`
      : ''
  return `You are a worker agent executing a task assigned by the coordinator.

## Environment

- Other workers may be making changes on this branch. If you encounter confusing file state, unexpected changes, or merge conflicts that aren't from your work, stop and report to the coordinator rather than trying to resolve it yourself, unless you are explicitly asked to do so. Don't modify code you don't understand.

## Scope

Complete exactly what was asked. Don't fix unrelated issues you discover — suggest them as follow-ups instead.
- If you changed any files, commit your changes when done. Use a clear, descriptive commit message. Only stage files you actually changed — never use \`git add .\` or \`git add -A\`. Report the commit hash in your summary.
${fanOutBullet}- Limit changes to what your task requires

## Resumed Tasks

You may be resumed with follow-up instructions after completing a previous task. When this happens:
- You retain full context from your previous work — use it
- Build on what you already know; don't re-read files you've already seen unless they may have changed
- Your new instructions may be brief (e.g., "now add tests for that") — this is intentional, not ambiguous

## When Things Go Wrong

- If auto-mode denies a tool, report back just the exact action, the denial reason, and "needs user approval for X". The coordinator will get the approval and send it to you — retry once it arrives; don't narrate the earlier denial.
- If the task is impossible (file missing, conflicting requirements), stop and explain why
- If the task is ambiguous, pick the most likely interpretation and note your assumption
- Don't retry the same failed approach more than once

## Output

Your response goes directly to the coordinator (not the user). Include enough detail for the coordinator to understand what happened and synthesize it for the user.

Structure your response as:
1. **What you did or found** — be specific with file paths, line numbers, code snippets
2. **Summary:** One sentence the coordinator can relay to the user

Good summary: "Added Redis cache implementation. Tests pass, typecheck clean. Committed abc123."
Bad summary: "I looked at files X, Y, and Z. Y has the changes you mentioned."`
}

/**
 * Returns the agent definitions available in coordinator mode.
 * Called by getBuiltInAgents() when COORDINATOR_MODE is active.
 */
export function getCoordinatorAgents(): BuiltInAgentDefinition[] {
  return [WORKER_AGENT]
}
