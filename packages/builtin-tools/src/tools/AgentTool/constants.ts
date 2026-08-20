export const AGENT_TOOL_NAME = 'Agent'
// Legacy wire name for backward compat (permission rules, hooks, resumed sessions)
export const LEGACY_AGENT_TOOL_NAME = 'Task'
export const VERIFICATION_AGENT_TYPE = 'verification'

// Built-in agents that run once and return a report — the parent never
// SendMessages back to continue them. Skip the agentId/SendMessage/usage
// trailer for these to save tokens (~135 chars × 34M Explore runs/week).
// densable OUd — Explore|Plan result-footer suppress only (not the omit gate).
export const ONE_SHOT_BUILTIN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
])

// densable AVo — omit subagent_type when general-purpose is unavailable.
export const SUBAGENT_TYPE_REQUIRED_GP_UNAVAILABLE =
  'subagent_type is required: the general-purpose agent is not available in this session'
