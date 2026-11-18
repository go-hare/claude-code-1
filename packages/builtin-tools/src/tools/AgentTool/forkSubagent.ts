import type { BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import { getIsNonInteractiveSession } from 'src/bootstrap/state.js'
import { isEnvDefinedFalsy, isEnvTruthy } from 'src/utils/envUtils.js'
import {
  FORK_BOILERPLATE_TAG,
  FORK_DIRECTIVE_PREFIX,
} from 'src/constants/xml.js'
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { isForkSubagentDisabled } from 'src/utils/sessionBackgroundGates.js'
import type {
  AssistantMessage,
  Message as MessageType,
} from 'src/types/message.js'
import { logForDebugging } from 'src/utils/debug.js'
import { createUserMessage } from 'src/utils/messages.js'
import { AGENT_TOOL_NAME } from './constants.js'
import type { BuiltInAgentDefinition } from './loadAgentsDir.js'

/**
 * Fork subagent feature gate (AgentTool + `/fork` share this).
 *
 * When enabled:
 * - `subagent_type: fork` is an explicit spawn (never the omit-type default)
 * - The child inherits the parent's full conversation context and system prompt
 * - Eligible agent spawns run in the background (async) for a unified
 *   `<task-notification>` interaction model
 * - `/fork <directive>` slash command is available
 *
 * Session constraints (densable 2.1.289 Omo / Imo / cHr):
 * - Coordinator (`ePe`) and `CLAUDE_CODE_FORK_SUBAGENT=false` disable Yne
 *   before the session sticky is read.
 * - Imo does not consult USER_TYPE or the 2.1.232 ant gate. Explicit env
 *   true is "env" even when non-interactive; otherwise Ce (`!isInteractive`)
 *   returns "disabled" (not written), and the default source is "default".
 * - A non-disabled Imo result sticks on the session (`forkSubagentEnabledSource`)
 *   and later env clears do not re-run Ce. Env false and coordinator still win.
 * - `/fork` and `/subtask` follow gold `isEnabled: () => !coordinator`.
 *   Their call bodies do not re-check Yne or headless.
 * - Schema, Ht/qt, and the fork prompt use Yne. An inner call can still
 *   fork when Yne is off via cHr (`isForkSubagentScriptCallEnabled`).
 * - There is no compile `FORK_SUBAGENT` gate. Official Yne does not read it.
 */
type ForkProductSource = 'env' | 'default'

/** densable Oo().forkSubagentEnabledSource — session sticky for Omo. */
let forkProductSource: ForkProductSource | undefined

/** Test helper — a new official session drops the sticky. */
export function resetForkSubagentProductSource(): void {
  forkProductSource = undefined
}

export function resolveForkSubagentProductSource():
  | ForkProductSource
  | 'disabled' {
  // Omo / wLn: coordinator, mcp serve, and env false win before the sticky read.
  if (isCoordinatorMode()) return 'disabled'
  if (isForkSubagentDisabled()) return 'disabled'
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'mcp') return 'disabled'
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_FORK_SUBAGENT))
    return 'disabled'
  if (forkProductSource !== undefined) return forkProductSource
  // wLn (2.1.302 #924): on by default in claude -p / SDK / desktop / VS Code
  // unless tengu_federated_ullman disables non-interactive default-on.
  if (
    !isEnvTruthy(process.env.CLAUDE_CODE_FORK_SUBAGENT) &&
    getIsNonInteractiveSession() &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_federated_ullman', false)
  ) {
    return 'disabled'
  }
  const source: ForkProductSource = isEnvTruthy(
    process.env.CLAUDE_CODE_FORK_SUBAGENT,
  )
    ? 'env'
    : 'default'
  forkProductSource = source
  logEvent('tengu_fork_subagent_enabled', {
    source:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return source
}

export function isForkSubagentProductEnabled(): boolean {
  return resolveForkSubagentProductSource() !== 'disabled'
}

/**
 * SEA `IFt()` (2.1.302 #925) — true when fork subagent gating forces
 * main-thread spawns into the background (terminal, desktop app, VS Code, or
 * `CLAUDE_CODE_FORK_SUBAGENT=1`). False in `claude -p` / Agent SDK unless
 * `CLAUDE_CODE_FORK_SUBAGENT=1`.
 */
export function isForkSubagentForceAsyncEnabled(): boolean {
  const source = resolveForkSubagentProductSource()
  if (source === 'disabled') return false
  if (source === 'env') return true
  if (!getIsNonInteractiveSession()) return true
  const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  return (
    entrypoint === 'claude-desktop' ||
    entrypoint === 'claude-desktop-3p' ||
    entrypoint === 'local-agent' ||
    entrypoint === 'claude-vscode'
  )
}

/**
 * densable cHr — `!ePe() && CLAUDE_CODE_FORK_SUBAGENT !== false`.
 * Cn treats an inner/script call as fork-capable when this is on, even if
 * Yne is off because the session is non-interactive.
 */
export function isForkSubagentScriptCallEnabled(): boolean {
  if (isCoordinatorMode()) return false
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_FORK_SUBAGENT)) return false
  return true
}

/** Synthetic agent type name used for analytics when the fork path fires. */
export const FORK_SUBAGENT_TYPE = 'fork'

/**
 * Synthetic agent definition for the fork path.
 *
 * Not registered in builtInAgents — used when `subagent_type` is fork (NFKC)
 * and the experiment is active. `tools: ['*']` with `useExactTools` means the fork
 * child receives the parent's exact tool pool (for cache-identical API
 * prefixes). `permissionMode: 'bubble'` surfaces permission prompts to the
 * parent terminal. `model: 'inherit'` keeps the parent's model for context
 * length parity.
 *
 * The getSystemPrompt here is unused: the fork path passes
 * `override.systemPrompt` with the parent's already-rendered system prompt
 * bytes, threaded via `toolUseContext.renderedSystemPrompt`. Reconstructing
 * by re-calling getSystemPrompt() can diverge (GrowthBook cold→warm) and
 * bust the prompt cache; threading the rendered bytes is byte-exact.
 */
export const FORK_AGENT = {
  agentType: FORK_SUBAGENT_TYPE,
  whenToUse:
    'Fork — inherits full conversation context. Selected explicitly via subagent_type: "fork" when the fork gate is on; never the default.',
  tools: ['*'],
  maxTurns: 200,
  model: 'inherit',
  permissionMode: 'bubble',
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () => '',
} satisfies BuiltInAgentDefinition

/**
 * Guard against recursive forking. Fork children keep the Agent tool in their
 * tool pool for cache-identical tool definitions, so we reject fork attempts
 * at call time by detecting the fork boilerplate tag in conversation history.
 */
export function isInForkChild(messages: MessageType[]): boolean {
  return messages.some(m => {
    if (m.type !== 'user') return false
    const content = m.message!.content
    if (!Array.isArray(content)) return false
    return content.some(
      block =>
        block.type === 'text' &&
        block.text.includes(`<${FORK_BOILERPLATE_TAG}>`),
    )
  })
}

export const FORK_OWN_PLACEHOLDER_RESULT = 'Fork started — that fork is you.'
export const FORK_OWN_NON_AGENT_PLACEHOLDER_RESULT =
  "This call started a fork, and that fork is you. The call's other work and its result belong to the parent."
export const FORK_SIBLING_PLACEHOLDER_RESULT =
  "This is the parent's call, not yours. It may not have run yet, and its result goes to the parent."

/**
 * Build the forked conversation messages for the child agent.
 *
 * For prompt cache sharing, all fork children share the parent assistant message
 * and receive tool_results for every tool_use block, distinguishing the child's
 * own launch (`ownToolUseId`) from sibling parent calls (SEA `ZEs` 2.1.307 #1098).
 */
export function buildForkedMessages(
  directive: string,
  assistantMessage: AssistantMessage,
  ownToolUseId?: string,
): MessageType[] {
  // Clone the assistant message to avoid mutating the original, keeping all
  // content blocks (thinking, text, and every tool_use)
  const fullAssistantMessage: AssistantMessage = {
    ...assistantMessage,
    uuid: randomUUID(),
    message: {
      ...assistantMessage.message,
      content: [
        ...(Array.isArray(assistantMessage.message.content)
          ? assistantMessage.message.content
          : []),
      ],
    },
  }

  // Collect all tool_use blocks from the assistant message
  const toolUseBlocks = (
    Array.isArray(assistantMessage.message.content)
      ? assistantMessage.message.content
      : []
  ).filter((block): block is BetaToolUseBlock => block.type === 'tool_use')

  if (toolUseBlocks.length === 0) {
    logForDebugging(
      `No tool_use blocks found in assistant message for fork directive: ${directive.slice(0, 50)}...`,
      { level: 'error' },
    )
    return [
      createUserMessage({
        content: [
          { type: 'text' as const, text: buildChildMessage(directive) },
        ],
      }),
    ]
  }

  // Build tool_result blocks for every tool_use, identifying this fork's own
  // tool_use_id vs sibling parent calls (SEA ZEs: S9r / A9r / P9r).
  const ownId = toolUseBlocks.length === 1 ? toolUseBlocks[0]?.id : ownToolUseId
  const toolResultBlocks = toolUseBlocks.map(block => ({
    type: 'tool_result' as const,
    tool_use_id: block.id,
    content: [
      {
        type: 'text' as const,
        text:
          block.id !== ownId
            ? FORK_SIBLING_PLACEHOLDER_RESULT
            : block.name === AGENT_TOOL_NAME || block.name === 'Task'
              ? FORK_OWN_PLACEHOLDER_RESULT
              : FORK_OWN_NON_AGENT_PLACEHOLDER_RESULT,
      },
    ],
  }))

  // Build a single user message: all placeholder tool_results + the per-child directive
  // TODO(smoosh): this text sibling creates a [tool_result, text] pattern on the wire
  // (renders as </function_results>\n\nHuman:<text>). One-off per-child construction,
  // not a repeated teacher, so low-priority. If we ever care, use smooshIntoToolResult
  // from src/utils/messages.ts to fold the directive into the last tool_result.content.
  const toolResultMessage = createUserMessage({
    content: [
      ...toolResultBlocks,
      {
        type: 'text' as const,
        text: buildChildMessage(directive),
      },
    ],
  })

  return [fullAssistantMessage, toolResultMessage]
}

export function buildChildMessage(directive: string, extraRule = ''): string {
  return `<${FORK_BOILERPLATE_TAG}>
You are a worker fork. The transcript above is the parent's history — inherited reference, not your situation. You are NOT a continuation of that agent. Execute ONE directive, then stop.

Hard rules:
- Do NOT spawn subagents with the ${AGENT_TOOL_NAME} tool. The "default to forking" guidance is for the parent; you ARE the fork, execute directly.${extraRule}
- One shot: report once and stop. No follow-up questions, no proposed next steps, no waiting for the user.

Guidelines (your directive may override any of these):
- Stay in scope. Other forks may be handling adjacent work; if you spot something outside your directive, note it in a sentence and move on.
- Open with one line restating your task, so the parent can spot scope drift at a glance.
- Be concise — as short as the answer allows, no shorter. Plain text, no preamble, no meta-commentary.
- If you committed changes, list the paths and commit hashes in your report.
</${FORK_BOILERPLATE_TAG}>

${FORK_DIRECTIVE_PREFIX}${directive}`
}

/**
 * Notice injected into fork children running in an isolated worktree.
 * Tells the child to translate paths from the inherited context, re-read
 * potentially stale files, and that its changes are isolated.
 */
export function buildWorktreeNotice(
  parentCwd: string,
  worktreeCwd: string,
): string {
  return `You've inherited the conversation context above from a parent agent working in ${parentCwd}. You are operating in an isolated git worktree at ${worktreeCwd} — same repository, same relative file structure, separate working copy. Paths in the inherited context refer to the parent's working directory; translate them to your worktree root. Re-read files before editing if the parent may have modified them since they appear in the context. Your changes stay in this worktree and will not affect the parent's files.`
}
