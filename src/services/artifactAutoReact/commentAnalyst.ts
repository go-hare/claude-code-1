/**
 * densable Ur @194396238 — spawn COMMENT_ANALYST_AGENT with Xo always on.
 */
import {
  getIsNonInteractiveSession,
  getParentSessionId,
} from '../../bootstrap/state.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../../Tool.js'
import { parseArtifactUrl } from '../../utils/artifactUrl.js'
import {
  getAgentContext,
  runWithAgentContext,
  type SubagentContext,
} from '../../utils/agentContext.js'
import { createUserMessage, extractTextContent } from '../../utils/messages.js'
import {
  getAgentContextDepth,
  resolveMaxSubagentSpawnDepth,
} from '../../utils/sessionSpawnCaps.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { createAgentId } from '../../utils/uuid.js'
import { ARTIFACT_TOOL_NAME } from '@claude-code/builtin-tools/tools/ArtifactTool/prompt.js'
import {
  COMMENT_ANALYST_AGENT,
  COMMENT_ANALYST_AGENT_TYPE,
  COMMENT_ANALYST_BRIEF_HEADER,
} from '@claude-code/builtin-tools/tools/AgentTool/built-in/commentThreadAnalyst.js'
import { logForDebugging } from '../../utils/debug.js'
import type { ArtifactComment, ArtifactThread } from './commentRead.js'
import { getNztHost } from './nzt.js'

/** densable Nr @194396216 */
export const COMMENT_ANALYST_BRIEF_CAP = 4000

const ANALYST_SCOPE_DENY =
  'The comment-thread analyst is read-only and scoped to its one artifact and thread: only the Artifact comments read with thread_id set to the dispatched thread, and the page-data read on the dispatched artifact, are permitted.'

const SCOPED_ACTIONS = new Set(['comments', 'read_page_data'])

export type SpawnCommentThreadAnalystInput = {
  url: string
  slug: string
  thread: ArtifactThread
  triggerComment: ArtifactComment
  signal?: AbortSignal
  toolUseContext?: ToolUseContext
}

function isScopedArtifactInput(
  input: unknown,
  slug: string,
  threadId: string,
): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return false
  }
  const rec = input as Record<string, unknown>
  const action = rec.action
  const url = rec.url
  if (typeof action !== 'string' || !SCOPED_ACTIONS.has(action)) {
    return false
  }
  if (typeof url !== 'string' || parseArtifactUrl(url)?.slug !== slug) {
    return false
  }
  if (action === 'comments' && rec.thread_id !== threadId) {
    return false
  }
  return true
}

/** densable rs @194395367 — Artifact comments / read_page_data only. */
export function commentAnalystCanUseTool(
  slug: string,
  threadId: string,
): CanUseToolFn {
  return async (tool, input) => {
    if (
      tool.name !== ARTIFACT_TOOL_NAME ||
      !isScopedArtifactInput(input, slug, threadId)
    ) {
      return {
        behavior: 'deny',
        message: ANALYST_SCOPE_DENY,
        decisionReason: {
          type: 'other',
          reason: 'comment analyst read-only scope',
        },
      }
    }
    return { behavior: 'allow', updatedInput: input }
  }
}

async function collectAnalystBrief(
  stream: AsyncIterable<{
    type?: string
    isApiErrorMessage?: boolean
    message?: { content?: unknown }
  }>,
): Promise<string | null> {
  let last = ''
  let sawApiError = false
  for await (const msg of stream) {
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) {
      continue
    }
    if (msg.isApiErrorMessage === true) {
      sawApiError = true
      continue
    }
    const text = extractTextContent(
      msg.message.content as ReadonlyArray<{ readonly type: string }>,
      '\n',
    ).trim()
    if (text !== '') {
      last = text
      sawApiError = false
    }
  }
  return sawApiError ? null : last
}

/**
 * densable Ur — spawn comment-thread-analyst with delegatedObservation
 * always set (gold Xo @194396736). Returns the ANALYSIS BRIEF or null.
 */
export async function spawnCommentThreadAnalyst(
  input: SpawnCommentThreadAnalystInput,
): Promise<string | null> {
  if (getIsNonInteractiveSession()) return null
  const hostCtx =
    input.toolUseContext ?? getNztHost()?.getToolUseContext() ?? undefined
  if (hostCtx === undefined) return null
  const parentDepth = getAgentContextDepth(getAgentContext())
  if (parentDepth >= resolveMaxSubagentSpawnDepth()) {
    logForDebugging('[artifact] analyst_depth_refused')
    return null
  }
  const agentId = createAgentId(COMMENT_ANALYST_AGENT_TYPE)
  const agentContext: SubagentContext = {
    agentId,
    depth: parentDepth + 1,
    parentSessionId: getParentSessionId(),
    agentType: 'subagent',
    subagentName: COMMENT_ANALYST_AGENT.agentType,
    isBuiltIn: true,
    // Gold Ur always sets Xo — do not inherit-only from parent.
    delegatedObservation: true,
    invocationKind: 'spawn',
    invocationEmitted: false,
  }
  const prompt = `Analyze artifact comment thread ${input.thread.id} on artifact ${input.url} (triggering comment id ${input.triggerComment.id}). Follow your workflow and output the analysis brief.`
  let detachAbort = (): void => {}
  try {
    const { runAgent } = await import(
      '@claude-code/builtin-tools/tools/AgentTool/runAgent.js'
    )
    const tools = hostCtx.options.tools ?? []
    const linked =
      input.signal !== undefined
        ? linkAbortSignals(input.signal, hostCtx.abortController)
        : undefined
    detachAbort = linked?.detach ?? detachAbort
    const abort = linked?.controller ?? hostCtx.abortController
    const brief = await runWithAgentContext(agentContext, () =>
      collectAnalystBrief(
        runAgent({
          agentDefinition: COMMENT_ANALYST_AGENT,
          promptMessages: [createUserMessage({ content: prompt })],
          toolUseContext: { ...hostCtx, abortController: abort },
          canUseTool: commentAnalystCanUseTool(input.slug, input.thread.id),
          isAsync: false,
          querySource: 'artifact_comment_analyst',
          availableTools: tools,
          override: {
            agentId,
            userContext: {},
            systemContext: {},
            systemPrompt: asSystemPrompt([
              COMMENT_ANALYST_AGENT.getSystemPrompt({
                toolUseContext: hostCtx,
              }),
            ]),
          },
          description: `artifact comment thread ${input.thread.id}`,
        }),
      ),
    )
    if (brief === null) {
      logForDebugging('[artifact] analyst_run_error')
      return null
    }
    if (brief === '') {
      logForDebugging('[artifact] analyst_empty_brief')
      return null
    }
    if (!brief.startsWith(COMMENT_ANALYST_BRIEF_HEADER)) {
      logForDebugging('[artifact] analyst_truncated')
      return null
    }
    return brief.length > COMMENT_ANALYST_BRIEF_CAP
      ? brief.slice(0, COMMENT_ANALYST_BRIEF_CAP)
      : brief
  } catch {
    logForDebugging('[artifact] analyst_run_error')
    return null
  } finally {
    detachAbort()
  }
}

function linkAbortSignals(
  signal: AbortSignal,
  parent: AbortController,
): { controller: AbortController; detach: () => void } {
  const next = new AbortController()
  const abort = (): void => next.abort()
  const detach = (): void => {
    signal.removeEventListener('abort', abort)
    parent.signal.removeEventListener('abort', abort)
  }
  if (signal.aborted || parent.signal.aborted) {
    next.abort()
    return { controller: next, detach }
  }
  signal.addEventListener('abort', abort)
  parent.signal.addEventListener('abort', abort)
  return { controller: next, detach }
}
