/**
 * Permission bridge: maps Claude Code's canUseTool / PermissionDecision
 * system to ACP's requestPermission() flow.
 *
 * Official option ids come from permissionOptions.ts (allow-once /
 * allow-with-updates / skill / ExitPlan keep-context). Legacy allow /
 * allow_always aliases are not advertised and not decoded.
 */
import type {
  AgentSideConnection,
  PermissionOption,
  ToolCallUpdate,
  ClientCapabilities,
} from '@agentclientprotocol/sdk'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type {
  PermissionAllowDecision,
  PermissionAskDecision,
  PermissionDenyDecision,
  PermissionUpdate,
} from '../../types/permissions.js'
import type { Tool as ToolType, ToolUseContext } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import {
  applyPermissionUpdates,
  persistPermissionUpdates,
} from '../../utils/permissions/PermissionUpdate.js'
import { hasPermissionsToUseTool } from '../../utils/permissions/permissions.js'
import { toolInfoFromToolUse } from './bridge.js'
import {
  ACP_ALLOW_ONCE,
  ACP_REJECT,
  buildExitPlanPermissionOptions,
  buildStandardPermissionOptions,
  decodeStandardPermissionOption,
  durableUpdatesForAllow,
  isOfferedOption,
  resolveExitPlanModeId,
  skillExactUpdates,
  skillPrefixUpdates,
} from './permissionOptions.js'
import { buildPermissionRequestMeta } from './permissionPresentation.js'

/**
 * Creates a CanUseToolFn that delegates permission decisions to the
 * ACP client via requestPermission().
 */
export function createAcpCanUseTool(
  conn: AgentSideConnection,
  sessionId: string,
  _getCurrentMode: () => string,
  clientCapabilities?: ClientCapabilities,
  cwd?: string,
  onModeChange?: (modeId: string) => void,
  isBypassModeAvailable?: () => boolean,
  /**
   * Invoked when the ACP client returns a `cancelled` permission outcome.
   * The Agent uses this to set the session-level cancelled flag and interrupt
   * the running query so session/prompt resolves with StopReason::Cancelled
   * (schema.json:629) instead of treating the cancellation as a plain deny.
   * Optional for backwards compatibility with callers that have not been
   * wired up yet.
   */
  onPermissionCancelled?: () => void,
  getAvailableModeIds?: () => readonly string[],
): CanUseToolFn {
  return async (
    tool: ToolType,
    input: Record<string, unknown>,
    context: ToolUseContext,
    assistantMessage: AssistantMessage,
    toolUseID: string,
    forceDecision?:
      | PermissionAllowDecision
      | PermissionAskDecision
      | PermissionDenyDecision,
  ): Promise<
    PermissionAllowDecision | PermissionAskDecision | PermissionDenyDecision
  > => {
    const supportsTerminalOutput = checkTerminalOutput(clientCapabilities)

    // ── ExitPlanMode special handling ────────────────────────────
    if (tool.name === 'ExitPlanMode') {
      return handleExitPlanMode(
        conn,
        sessionId,
        toolUseID,
        input,
        supportsTerminalOutput,
        cwd,
        onModeChange,
        isBypassModeAvailable,
        onPermissionCancelled,
        getAvailableModeIds,
      )
    }

    // ── Force decision bypass (used by coordinator/swarm workers) ──
    if (forceDecision !== undefined) {
      return forceDecision
    }

    // ── Run through the normal permission pipeline ────────────────
    // This handles: deny rules, allow rules, tool-specific checks,
    // bypassPermissions mode, dontAsk mode, acceptEdits mode, auto mode classifier
    let ask: PermissionAskDecision | undefined
    try {
      const pipelineResult = await hasPermissionsToUseTool(
        tool,
        input,
        context,
        assistantMessage,
        toolUseID,
      )

      // If the pipeline resolved to allow or deny, return that
      if (pipelineResult.behavior === 'allow') {
        return pipelineResult as PermissionAllowDecision
      }
      if (pipelineResult.behavior === 'deny') {
        return pipelineResult as PermissionDenyDecision
      }
      ask = pipelineResult as PermissionAskDecision
    } catch (err) {
      console.error('[ACP Permissions] Pipeline error:', err)
      return {
        behavior: 'deny',
        message: 'Permission pipeline failed',
        decisionReason: {
          type: 'other',
          reason: 'Permission pipeline failed',
        },
        toolUseID,
      }
    }

    // ── Delegate to ACP client for interactive permission decision ──
    const info = toolInfoFromToolUse(
      { name: tool.name, id: toolUseID, input },
      supportsTerminalOutput,
      cwd,
    )

    const toolCall: ToolCallUpdate = {
      toolCallId: toolUseID,
      title: info.title,
      kind: info.kind,
      status: 'pending',
      rawInput: input,
    }

    const options = buildAcpPermissionOptions({
      toolName: tool.name,
      input,
      allowPersistent: ask?.suppressAlwaysAllowRule !== true,
      suggestions: ask?.suggestions,
      displayName: info.title,
      cwd,
    })

    try {
      const response = await conn.requestPermission({
        sessionId,
        toolCall,
        options,
        _meta: buildPermissionRequestMeta({
          toolName: tool.name,
          title: info.title,
          decisionReason: ask?.message,
        }),
      })

      if (response.outcome.outcome === 'cancelled') {
        // Per schema.json:629, a cancelled permission outcome means the prompt
        // turn was cancelled. Signal the session so prompt() resolves with
        // StopReason::Cancelled instead of treating this as a normal denial.
        onPermissionCancelled?.()
        return {
          behavior: 'deny',
          message: 'Permission request cancelled by client',
          decisionReason: { type: 'mode', mode: 'default' },
          toolUseID,
        }
      }

      if (
        response.outcome.outcome === 'selected' &&
        'optionId' in response.outcome &&
        response.outcome.optionId !== undefined
      ) {
        const optionId = response.outcome.optionId
        const allowed = settleStandardPermissionOption({
          optionId,
          options,
          toolName: tool.name,
          input,
          suggestions: ask?.suggestions,
          context,
        })
        if (allowed) return allowed
      }

      // Default: deny
      return {
        behavior: 'deny',
        message: 'Permission denied by client',
        decisionReason: { type: 'mode', mode: 'default' },
      }
    } catch (err) {
      console.error('[ACP Permissions] Client request error:', err)
      return {
        behavior: 'deny',
        message: 'Permission request failed',
        decisionReason: { type: 'mode', mode: 'default' },
      }
    }
  }
}

async function handleExitPlanMode(
  conn: AgentSideConnection,
  sessionId: string,
  toolUseID: string,
  input: Record<string, unknown>,
  supportsTerminalOutput: boolean,
  cwd?: string,
  onModeChange?: (modeId: string) => void,
  isBypassModeAvailable?: () => boolean,
  onPermissionCancelled?: () => void,
  getAvailableModeIds?: () => readonly string[],
): Promise<PermissionAllowDecision | PermissionDenyDecision> {
  const options = buildExitPlanPermissionOptions(
    getAvailableModeIds?.() ??
      defaultExitPlanAvailableModeIds(isBypassModeAvailable),
  )

  const info = toolInfoFromToolUse(
    { name: 'ExitPlanMode', id: toolUseID, input },
    supportsTerminalOutput,
    cwd,
  )

  const toolCall: ToolCallUpdate = {
    toolCallId: toolUseID,
    title: info.title,
    kind: info.kind,
    status: 'pending',
    rawInput: input,
  }

  try {
    const response = await conn.requestPermission({
      sessionId,
      toolCall,
      options,
      _meta: buildPermissionRequestMeta({
        toolName: 'ExitPlanMode',
        title: info.title,
      }),
    })

    if (response.outcome.outcome === 'cancelled') {
      // Propagate cancellation so prompt() resolves with StopReason::Cancelled.
      onPermissionCancelled?.()
      return {
        behavior: 'deny',
        message: 'Tool use aborted',
        decisionReason: { type: 'mode', mode: 'default' },
      }
    }

    if (
      response.outcome.outcome === 'selected' &&
      'optionId' in response.outcome &&
      response.outcome.optionId !== undefined
    ) {
      const selectedOption = response.outcome.optionId
      const modeId = resolveExitPlanModeId(selectedOption)
      if (isOfferedOption(selectedOption, options) && modeId) {
        onModeChange?.(modeId)

        try {
          await conn.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: 'current_mode_update',
              currentModeId: modeId,
            },
          })
        } catch (err) {
          // Mode already applied locally. Keep allow so a notify failure
          // does not undo the user's choice or surface a raw transport error.
          console.error('[ACP Permissions] ExitPlanMode sessionUpdate:', err)
        }

        return {
          behavior: 'allow',
          updatedInput: input,
        }
      }
    }

    return {
      behavior: 'deny',
      message: 'User rejected request to exit plan mode.',
      decisionReason: { type: 'mode', mode: 'plan' },
    }
  } catch (err) {
    console.error('[ACP Permissions] Client request error:', err)
    return {
      behavior: 'deny',
      message: 'Permission request failed',
      decisionReason: { type: 'mode', mode: 'default' },
    }
  }
}

function defaultExitPlanAvailableModeIds(
  isBypassModeAvailable?: () => boolean,
): readonly string[] {
  return [
    'default',
    'acceptEdits',
    'auto',
    ...(isBypassModeAvailable?.() === true ? ['bypassPermissions'] : []),
  ]
}

function buildAcpPermissionOptions(args: {
  toolName: string
  input: Record<string, unknown>
  allowPersistent: boolean
  suggestions?: PermissionUpdate[]
  displayName?: string
  cwd?: string
}): PermissionOption[] {
  // Official AskUserQuestion is elicitation, not permission options.
  // SDK 0.19 has no elicitation host — advertise one-shot Yes/No only.
  if (args.toolName === 'AskUserQuestion') {
    return [
      { optionId: ACP_ALLOW_ONCE, name: 'Yes', kind: 'allow_once' },
      { optionId: ACP_REJECT, name: 'No', kind: 'reject_once' },
    ]
  }
  return buildStandardPermissionOptions(args)
}

function persistAcpPermissionUpdates(
  context: ToolUseContext,
  updates: PermissionUpdate[],
): void {
  if (updates.length === 0) return
  persistPermissionUpdates(updates)
  if (typeof context.setSessionToolPermissionContext !== 'function') return
  context.setSessionToolPermissionContext(prev =>
    applyPermissionUpdates(prev, updates),
  )
}

function settleStandardPermissionOption(args: {
  optionId: string
  options: readonly PermissionOption[]
  toolName: string
  input: Record<string, unknown>
  suggestions?: PermissionUpdate[]
  context: ToolUseContext
}): PermissionAllowDecision | undefined {
  if (!isOfferedOption(args.optionId, args.options)) return undefined
  const decoded = decodeStandardPermissionOption(args.optionId)
  if (!decoded) return undefined
  switch (decoded.kind) {
    case 'allow-once':
      return { behavior: 'allow', updatedInput: args.input }
    case 'allow-durable':
      persistAcpPermissionUpdates(
        args.context,
        durableUpdatesForAllow(args.toolName, args.suggestions, args.input),
      )
      return { behavior: 'allow', updatedInput: args.input }
    case 'allow-skill-exact':
      persistAcpPermissionUpdates(args.context, skillExactUpdates(args.input))
      return { behavior: 'allow', updatedInput: args.input }
    case 'allow-skill-prefix': {
      const updates = skillPrefixUpdates(args.input)
      if (updates) persistAcpPermissionUpdates(args.context, updates)
      return { behavior: 'allow', updatedInput: args.input }
    }
    case 'reject-once':
    case 'reject-durable':
      return undefined
  }
}

function checkTerminalOutput(clientCapabilities?: ClientCapabilities): boolean {
  if (!clientCapabilities) return false
  // Standard ACP v1 capability: ClientCapabilities.terminal (boolean).
  if (clientCapabilities.terminal === true) return true
  // Legacy Claude-Code clients advertised terminal support via _meta before
  // the standard `terminal` boolean existed. `_meta` is reserved per the spec,
  // but we keep this fallback for backward compatibility with older clients.
  const meta = (clientCapabilities as unknown as Record<string, unknown>)._meta
  if (!meta || typeof meta !== 'object') return false
  return (meta as Record<string, unknown>)['terminal_output'] === true
}
