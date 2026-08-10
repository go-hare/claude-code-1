import { EXECUTE_TOOL_NAME } from './constants.js'

export const DESCRIPTION =
  'ExecuteExtraTool — compat core tool for providers that cannot expand tool_reference. Prefer calling discovered tools directly after ToolSearch on Anthropic-native paths.'

export function getPrompt(): string {
  return `ExecuteExtraTool — always loaded as a **compat** path. Runs locally with full permissions — NOT a remote or external tool.

## Prefer direct calls (native Anthropic / tool_reference)
On Anthropic-native sessions, ToolSearch returns \`tool_reference\` blocks; the API expands full schemas and you call the discovered tool **directly** by name — do **not** wrap every call through ExecuteExtraTool.

## When to use ExecuteExtraTool
ONLY when you cannot call a deferred tool directly (e.g. OpenAI-compat / providers without tool_reference expansion), after discovering it via ToolSearch. Core tools (Read, Edit, Write, Bash, Glob, Grep, Agent, WebFetch, WebSearch, Skill) are always in your tool list — call them directly, NEVER through ExecuteExtraTool.

## Compat two-step workflow (non-tool_reference providers)

Step 1: ToolSearch discovers the tool name and schema.
Step 2: ExecuteExtraTool runs it by name.

Example — schedule a cron when direct call is unavailable:
  ToolSearch({"query": "select:CronCreate"})
  → Response: "Found deferred tool(s): CronCreate" (or tool_reference on native)
  // Native: call CronCreate({...}) directly
  // Compat only:
  ExecuteExtraTool({"tool_name": "CronCreate", "params": {"schedule": "*/5 * * * *", "prompt": "check deploy"}})

## Inputs
- tool_name: Exact name of the target tool (string, e.g. "CronCreate", "mcp__slack__send_message")
- params: Object with the target tool's parameters (from ToolSearch schema).

## Failure handling
If this tool returns an error, do NOT retry or re-search. Tell the user what failed and suggest alternatives.`
}
