/**
 * Remote tool routing, forwarding, approval, standing-request tracking, and
 * background-shell ownership enforcement for `runToolUse`.
 */

import type {
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { TASK_STOP_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskStopTool/prompt.js'
import { isDeepStrictEqual } from 'util'
import { getCurrentStructuredIO } from '../../../cli/structuredIO.js'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { AssistantMessage, UserMessage } from '../../../types/message.js'
import { getAgentContext } from '../../../utils/agentContext.js'
import { logForDebugging } from '../../../utils/debug.js'
import { AbortError } from '../../../utils/errors.js'
import { shouldPreserveManagedToolHookPass } from '../../../utils/hooks/toolCallManagedPass.js'
import { logError } from '../../../utils/log.js'
import { createUserMessage } from '../../../utils/messages.js'
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js'
import { detachedLetGoPermissionDeny } from '../../../utils/permissions/permissions.js'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../../utils/sessionHost.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import { processPreMappedToolResultBlock } from '../../../utils/toolResultStorage.js'
import {
  RemoteBackgroundShells,
  RemoteToolHosts,
  type RemoteToolRoutedHost,
} from '../../../utils/toolState.js'
import {
  callRemotePlumbing,
  callRemoteTool,
  checkStandingRemoteTool,
  classifyHeldBody,
  classifyRemoteToolsProbe,
  REMOTE_PLUMBING_TOOLS,
  REMOTE_TOOL_DEADLINE_MS,
  REMOTE_TOOL_MAX_REQUEST_BYTES,
  REMOTE_TOOL_PROBE_CAP_MS,
  type RemoteToolHeld,
} from '../remoteToolCall.js'
import {
  type AnnouncedRemoteMachine,
  announcedRemoteMachines,
  announceWaitAlreadyExpired,
  askRemoteToolsReannounce,
  type DeviceBridgeMcpClient,
  isRemoteToolsForwardEnabled,
  machineAdoptingMcpTool,
  markRemoteMachineAway,
  noteRemoteMachineHeard,
  REMOTE_ANNOUNCE_WAIT_MS,
  REMOTE_HOST_INTERRUPTED,
  REMOTE_TOOL_HOST_FIELD,
  remoteHostAnsweredErrorMessage,
  remoteHostApprovalUnverifiedMessage,
  remoteHostDisconnectedMessage,
  remoteHostEnvelopeMessage,
  remoteHostGaveUpEarlierMessage,
  remoteHostGaveUpMessage,
  remoteHostGoneMessage,
  remoteHostIncompatibleMessage,
  remoteHostOfflineMessage,
  remoteHostProbeStalledMessage,
  remoteHostQueuedWithdrawnMessage,
  remoteHostRefusedByMessage,
  remoteHostRefusedUnrunMessage,
  remoteHostRoute,
  remoteHostServesNothingMessage,
  remoteHostTakenBackMessage,
  remoteHostTimedOutMessage,
  remoteHostTooLargeMessage,
  remoteHostToolNotServedMessage,
  remoteHostTransitFailedMessage,
  remoteHostUnreachableOutcome,
  remoteHostUnreadableEnvelopeMessage,
  remoteHostUnreadableToolMessage,
  remoteHostUnresponsiveMessage,
  remoteHostUnverifiedRefusalMessage,
  remoteHostWriteUnresolvedMessage,
  requestedRemoteHost,
  resolveAnnouncedMachine,
  syncBridgeRemoteHosts,
  syncSessionRemoteHosts,
  waitForAnnouncedMachine,
} from '../remoteToolHost.js'
import { extractRemoteRejectionFeedback } from './permissionGate.js'
import type { MessageUpdateLazy } from './types.js'

export function extractRemoteBackgroundTaskId(
  response: unknown,
): string | undefined {
  if (response === null || typeof response !== 'object') return undefined
  const rec = response as Record<string, unknown>
  if (typeof rec.backgroundTaskId === 'string') return rec.backgroundTaskId
  const envelope = rec.envelope
  if (envelope !== null && typeof envelope === 'object') {
    const output = (envelope as Record<string, unknown>).output
    if (output !== null && typeof output === 'object') {
      const id = (output as Record<string, unknown>).backgroundTaskId
      if (typeof id === 'string') return id
    }
  }
  const data = rec.data
  if (data !== null && typeof data === 'object') {
    const id = (data as { backgroundTaskId?: unknown }).backgroundTaskId
    if (typeof id === 'string') return id
  }
  const result = rec.result
  if (result !== null && typeof result === 'object') {
    const id = (result as { backgroundTaskId?: unknown }).backgroundTaskId
    if (typeof id === 'string') return id
  }
}

/** densable remote `_r` KLe.started when bash returns backgroundTaskId. */
function rememberRemoteBackgroundShell(
  context: ToolUseContext | undefined,
  input: Record<string, unknown>,
  response: unknown,
  hostName: string,
  callId: string,
): void {
  if (input.run_in_background !== true) return
  const id = extractRemoteBackgroundTaskId(response)
  if (!id || !context?.toolState) return
  context.toolState.get(RemoteBackgroundShells).started(id, {
    hostName,
    callId,
    agentId: context.agentId ?? getAgentContext()?.agentId,
  })
}

/** densable `_r` @213391300 — remote TaskStop must own the started shell ID. */
function checkRemoteTaskStopOwnership(
  toolName: string,
  inputRecord: Record<string, unknown>,
  hostName: string,
  source: 'session' | 'bridge',
  toolUseContext: ToolUseContext,
): string | undefined {
  if (toolName !== TASK_STOP_TOOL_NAME) return undefined
  const callerAgentId = toolUseContext.agentId ?? getAgentContext()?.agentId
  if (callerAgentId === undefined) return undefined
  const taskId = String(inputRecord.task_id ?? inputRecord.shell_id ?? '')
  if (
    toolUseContext.toolState
      ?.get(RemoteBackgroundShells)
      .find(taskId, callerAgentId)?.hostName === hostName
  ) {
    return undefined
  }
  const message = `No background command with that ID was started on ${hostName} by this agent.`
  return source === 'session'
    ? remoteHostRefusedByMessage(hostName, message)
    : remoteHostRefusedUnrunMessage(hostName, message)
}

/** Requests left standing after their first deadline, keyed by request id. */
const standingRemoteToolsBySession = new RootSessionSlot<
  Map<string, RemoteToolHeld>
>(() => new Map<string, RemoteToolHeld>())

function getStandingRemoteTools(): Map<string, RemoteToolHeld> {
  return standingRemoteToolsBySession.of(getBootstrapSession())
}

/** densable `h.held` — the standing request for this id, if it is still up. */
export function standingRemoteTool(
  requestId: string,
): RemoteToolHeld | undefined {
  return standingRemoteToolsBySession
    .peek(getBootstrapSession())
    ?.get(requestId)
}

/** The text of a remote result, after densable `ae` rewrites an envelope. */
function remoteResultText(
  response: Record<string, unknown> | undefined,
  machine: { name: string; source: 'session' | 'bridge'; homeDir?: string },
): {
  content: string | Array<Record<string, unknown>>
  isError: boolean
  output?: Record<string, unknown>
} {
  const envelope = response?.envelope
  if (envelope !== null && typeof envelope === 'object') {
    const record = envelope as Record<string, unknown>
    const rewritten = remoteHostEnvelopeMessage(
      machine.name,
      machine.source,
      record,
      response?.content ?? response?.text,
      machine.homeDir,
    )
    if (rewritten !== undefined) {
      return rewritten
    }
    return {
      content: remoteHostUnreadableEnvelopeMessage(machine.name),
      isError: true,
    }
  }
  const raw =
    typeof response?.text === 'string'
      ? response.text
      : jsonStringify(response ?? {})
  if (response?.is_error === true) {
    return {
      content: remoteHostAnsweredErrorMessage(machine.name, raw),
      isError: true,
    }
  }
  return { content: raw, isError: false }
}

function remoteToolOutcomeMessage(
  sent: {
    kind: string
    detail?: string
    capMs?: number
    request?: 'probe' | 'call'
    takenBack?: boolean
    requestId?: string
    why?: string
    unsent?: boolean
    whyDropped?: 'write_unresolved' | 'unverified_refusal'
    machineNotAnswering?: boolean
    requestBytes?: number
    unreadableResult?: boolean
    left?: boolean
    misses?: number
    whileRunning?: boolean
  },
  machine: { name: string; source: 'session' | 'bridge'; homeDir?: string },
): string {
  const name = machine.name
  const capMs = sent.capMs ?? REMOTE_TOOL_DEADLINE_MS
  switch (sent.kind) {
    case 'timed_out':
      return remoteHostTimedOutMessage(name, capMs, sent.left === true)
    case 'stalled':
      if (sent.request === 'probe') {
        return remoteHostProbeStalledMessage(name, capMs)
      }
      return sent.takenBack
        ? remoteHostTakenBackMessage(name, capMs)
        : remoteHostQueuedWithdrawnMessage(name, capMs)
    case 'unreachable':
      return remoteHostUnreachableOutcome(
        name,
        sent.detail ?? '',
        machine.source,
        sent.machineNotAnswering === true,
      )
    case 'dropped':
      if (sent.whyDropped === 'unverified_refusal') {
        return remoteHostUnverifiedRefusalMessage(name)
      }
      return sent.whyDropped === 'write_unresolved'
        ? remoteHostWriteUnresolvedMessage(name)
        : remoteHostDisconnectedMessage(name)
    case 'host_gone':
      return remoteHostGoneMessage(
        name,
        sent.why ?? 'restarted',
        sent.unsent === true,
      )
    case 'host_unresponsive':
      return remoteHostUnresponsiveMessage(
        name,
        sent.misses ?? 3,
        sent.capMs ?? 10_000,
        sent.whileRunning === true,
      )
    case 'too_large':
      return remoteHostTooLargeMessage(
        name,
        sent.requestBytes ?? 0,
        REMOTE_TOOL_MAX_REQUEST_BYTES,
      )
    case 'transport_error':
      if (sent.unreadableResult === true) {
        return remoteHostUnreadableEnvelopeMessage(name)
      }
      return remoteHostTransitFailedMessage(name, sent.detail ?? 'send failed')
    default:
      return sent.detail ?? sent.kind
  }
}

function noteHeldRemoteTool(
  sent: { requestId?: string; capMs?: number; sentUnderEpoch?: string },
  toolName: string,
  withdrawable: boolean,
): void {
  if (!sent.requestId) return
  const holder = getCurrentStructuredIO()?.takeHeldRemoteTool(sent.requestId)
  if (!holder) return
  const requestId = sent.requestId
  const standing = getStandingRemoteTools()
  const drop = () => {
    if (!requestId) return
    standing.delete(requestId)
  }
  const held: RemoteToolHeld = {
    late: classifyHeldBody(holder.late, {
      capMs: sent.capMs ?? REMOTE_TOOL_DEADLINE_MS,
      sentUnderEpoch: sent.sentUnderEpoch,
    }),
    withdraw: () => {
      drop()
      holder.withdraw()
    },
    takeBack: () => {
      if (!withdrawable) return false
      drop()
      return holder.takeBack()
    },
    accepted: () => holder.accepted(),
  }
  if (requestId) standing.set(requestId, held)
  void held.late.then(late => {
    const envelope = late.response?.envelope
    const outcome =
      envelope !== null && typeof envelope === 'object'
        ? (envelope as { outcome?: unknown; output_tail?: unknown })
        : undefined
    if (outcome?.outcome === 'in_progress') {
      const tail =
        typeof outcome.output_tail === 'string' ? outcome.output_tail : ''
      logForDebugging(
        `remote tool ${toolName} still running after its deadline: ${tail}`,
      )
    } else {
      logForDebugging(
        `remote tool ${toolName} answered after its deadline: ${late.kind}`,
      )
    }
    drop()
  })
}

/** densable Ta @213400800 — persist oversized remote tool results & gate subagent toolUseResult. */
async function buildRemoteSuccessUserMessage(opts: {
  tool: Tool
  toolUseId: string
  rendered: ReturnType<typeof remoteResultText>
  assistantMessage: AssistantMessage
  toolUseContext: ToolUseContext
}): Promise<UserMessage> {
  const preMapped: ToolResultBlockParam = {
    type: 'tool_result',
    content: opts.rendered.content as ToolResultBlockParam['content'],
    is_error: opts.rendered.isError,
    tool_use_id: opts.toolUseId,
  }
  const processedBlock = opts.rendered.isError
    ? preMapped
    : await processPreMappedToolResultBlock(
        preMapped,
        opts.tool.name,
        opts.tool.maxResultSizeChars,
      )
  return createUserMessage({
    content: [processedBlock],
    toolUseResult: shouldPreserveManagedToolHookPass(
      opts.toolUseContext,
      opts.tool,
    )
      ? (opts.rendered.output ?? opts.rendered.content)
      : undefined,
    sourceToolAssistantUUID: opts.assistantMessage.uuid,
  })
}

function formatTerminalPeriod(words: string): string {
  const trimmed = words.trimEnd()
  return /[.!?\u2026]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/** densable `_r` / `la` / `ua` @213391380 — subagent requireCanUseTool gate before remote dispatch. */
async function checkRemoteSubagentCallerGate(opts: {
  tool: Tool
  rawInput: Record<string, unknown>
  hostName: string
  source: 'session' | 'bridge'
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  assistantMessage: AssistantMessage
  toolUseId: string
}): Promise<string | undefined> {
  if (
    opts.toolUseContext.requireCanUseTool !== true ||
    opts.toolUseContext.agentId === undefined
  ) {
    return undefined
  }
  const defaultDenial = `Permission to use ${opts.tool.name} has been denied`
  let words: string | undefined
  try {
    const decision = await opts.canUseTool(
      opts.tool,
      opts.rawInput,
      opts.toolUseContext,
      opts.assistantMessage,
      opts.toolUseId,
    )
    if (decision.behavior === 'allow') {
      if (
        decision.updatedInput === undefined ||
        decision.updatedInput === opts.rawInput ||
        isDeepStrictEqual(decision.updatedInput, opts.rawInput)
      ) {
        return undefined
      }
      words = `The permission check for ${opts.tool.name} modified its input, which this background agent cannot apply`
    } else {
      words = decision.message || defaultDenial
    }
  } catch (err) {
    if (
      err instanceof AbortError ||
      opts.toolUseContext.abortController.signal.aborted
    ) {
      throw err
    }
    logError(err)
    words = `The permission check for this ${opts.tool.name} call failed with an error, so the call was refused`
  }
  const formatted = formatTerminalPeriod(words)
  return opts.source === 'session'
    ? remoteHostRefusedByMessage(opts.hostName, formatted)
    : remoteHostRefusedUnrunMessage(opts.hostName, formatted)
}

/** densable `pa` @213394100 — force interactive approval for remote needs_approval. */
async function approveRemoteToolCall(opts: {
  tool: Tool
  hostName: string
  cleanInput: Record<string, unknown>
  askMessage: unknown
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  assistantMessage: AssistantMessage
  toolUseId: string
}): Promise<
  | { kind: 'refused'; detail: string }
  | {
      kind: 'approved'
      effectiveInput: Record<string, unknown>
      updatedInput?: Record<string, unknown>
      feedback?: string
    }
  | { kind: 'denied'; feedback?: string }
> {
  const { getToolPermissionContextFromLayers } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../engine/permissionLayerReaders.js') as typeof import('../../../engine/permissionLayerReaders.js')
  const permissionCtx = getToolPermissionContextFromLayers(opts.toolUseContext)
  if (
    permissionCtx.mode === 'dontAsk' ||
    permissionCtx.shouldAvoidPermissionPrompts
  ) {
    const detail =
      permissionCtx.mode === 'dontAsk'
        ? `Permission to use ${opts.tool.name} has been denied because permission mode is dontAsk.`
        : `${opts.hostName} asked for approval, and this context cannot show a permission prompt; the call did not run.`
    return { kind: 'refused', detail }
  }
  const dialogInput: Record<string, unknown> =
    opts.tool.isMcp === true
      ? { ...opts.cleanInput }
      : { ...opts.cleanInput, [REMOTE_TOOL_HOST_FIELD]: opts.hostName }
  const askBody =
    typeof opts.askMessage === 'string' && opts.askMessage.trim() !== ''
      ? opts.askMessage.trim()
      : `Allow ${opts.tool.name}`
  const promptMessage = `(runs on ${opts.hostName}) ${askBody}`
  const forceDecision: PermissionDecision = {
    behavior: 'ask',
    message: promptMessage,
    decisionReason: { type: 'other', reason: promptMessage },
    suppressAlwaysAllowRule: true,
  }
  const promptTool =
    opts.tool.isMcp === true
      ? ({
          ...opts.tool,
          suppressesAlwaysAllowRule: () => true,
        } as Tool)
      : opts.tool
  const resolvedDecision = await opts.canUseTool(
    promptTool,
    dialogInput,
    opts.toolUseContext,
    opts.assistantMessage,
    opts.toolUseId,
    forceDecision,
  )
  const decision =
    detachedLetGoPermissionDeny(opts.toolUseId) ?? resolvedDecision
  if (decision.behavior === 'allow') {
    const edited = decision.updatedInput ?? {}
    const hostChanged =
      opts.tool.isMcp !== true &&
      REMOTE_TOOL_HOST_FIELD in edited &&
      requestedRemoteHost(edited) !== opts.hostName
    const newlyDisabledSandbox =
      edited.dangerouslyDisableSandbox === true &&
      opts.cleanInput.dangerouslyDisableSandbox !== true
    if (hostChanged || newlyDisabledSandbox) {
      return {
        kind: 'refused',
        detail: `The approval given in this session edited the ${opts.tool.name} call in a way ${opts.hostName} cannot honour (it named a different machine, or newly set a privileged field this session does not pass on in an edit); nothing ran.`,
      }
    }
    const { [REMOTE_TOOL_HOST_FIELD]: _dropHost, ...cleanEdited } = edited
    const hasEditedFields =
      Object.keys(cleanEdited).length > 0 &&
      !isDeepStrictEqual(cleanEdited, opts.cleanInput)
    const feedback =
      'acceptFeedback' in decision ? decision.acceptFeedback : undefined
    return {
      kind: 'approved',
      effectiveInput: hasEditedFields ? cleanEdited : opts.cleanInput,
      ...(hasEditedFields && { updatedInput: cleanEdited }),
      ...(feedback !== undefined && { feedback }),
    }
  }
  if (
    decision.behavior === 'deny' &&
    decision.decisionReason?.type === 'hook'
  ) {
    return { kind: 'refused', detail: decision.message }
  }
  const feedback = extractRemoteRejectionFeedback(decision)
  return {
    kind: 'denied',
    ...(feedback !== undefined && { feedback }),
  }
}

function remoteErrorMessage(
  toolUseId: string,
  detail: string,
  assistantUUID: AssistantMessage['uuid'],
): MessageUpdateLazy {
  return {
    message: createUserMessage({
      content: [
        {
          type: 'tool_result',
          content: `<tool_use_error>Error: ${detail}</tool_use_error>`,
          is_error: true,
          tool_use_id: toolUseId,
        },
      ],
      toolUseResult: detail,
      sourceToolAssistantUUID: assistantUUID,
    }),
  }
}

/**
 * Attempt to route and execute `toolUse` on a remote host (`routed_host` or
 * announced `remote` machine). Yields tool result updates and returns `true`
 * if handled remotely (including remote errors); returns `false` when the call
 * should proceed on the local host.
 */
export async function* tryRunRemoteToolUse(opts: {
  tool: Tool
  toolName: string
  toolUse: ToolUseBlock
  assistantMessage: AssistantMessage
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
}): AsyncGenerator<MessageUpdateLazy, boolean> {
  const {
    tool,
    toolName,
    toolUse,
    assistantMessage,
    canUseTool,
    toolUseContext,
  } = opts

  // densable `dr` / `lr`: forwarding off, or no machine name, stays local.
  // A resolved online machine that serves the tool is `W`. Anything else
  // is the route's own error (`sOn`, `zAt`, `cuo`).
  if (
    toolUseContext.toolState &&
    (tool.remoteExecution?.supported === true || tool.isMcp === true)
  ) {
    syncSessionRemoteHosts(toolUseContext.toolState, 'resolve')
    if (
      toolUseContext.options.mcpClients.some(
        client => client.name === 'remote-devices',
      )
    ) {
      await syncBridgeRemoteHosts(
        toolUseContext.toolState,
        'resolve',
        toolUseContext.options.mcpClients as unknown as DeviceBridgeMcpClient[],
      )
    }
  }

  const remoteHostsSlot = toolUseContext.toolState?.get(RemoteToolHosts)
  const resolveRoutedHostForTool = (
    host: RemoteToolRoutedHost,
    wireToolName: string,
    isPassthrough: boolean,
  ):
    | { kind: 'routed_host'; host: RemoteToolRoutedHost; wireToolName: string }
    | { kind: 'error'; message: string } => {
    if (host.status === 'offline' && host.source !== 'session') {
      return { kind: 'error', message: remoteHostOfflineMessage(host.name) }
    }
    if (host.protocol?.kind === 'incompatible') {
      return {
        kind: 'error',
        message: remoteHostIncompatibleMessage(
          host.name,
          host.protocol.announced,
          tool.name,
          isPassthrough,
          toolUseContext.toolState,
        ),
      }
    }
    if (host.rejectedPassthroughTools?.has(wireToolName) === true) {
      return {
        kind: 'error',
        message: remoteHostUnreadableToolMessage(host.name, tool.name),
      }
    }
    if (
      !isPassthrough &&
      host.servedTools !== undefined &&
      !host.servedTools.has(tool.name)
    ) {
      return {
        kind: 'error',
        message:
          host.servedTools.size === 0
            ? remoteHostServesNothingMessage(host.name)
            : remoteHostToolNotServedMessage(host.name, tool.name, [
                ...host.servedTools,
              ]),
      }
    }
    return { kind: 'routed_host', host, wireToolName }
  }

  let hostRoute:
    | ReturnType<typeof remoteHostRoute>
    | { kind: 'remote'; machine: AnnouncedRemoteMachine }
    | {
        kind: 'routed_host'
        host: RemoteToolRoutedHost
        wireToolName: string
      } = { kind: 'local' }
  const requestedHostName = requestedRemoteHost(toolUse.input)
  const adopting =
    tool.isMcp === true
      ? machineAdoptingMcpTool(tool.name, toolUseContext.toolState)
      : undefined
  if (adopting && requestedHostName === undefined) {
    hostRoute = { kind: 'remote', machine: adopting }
  } else if (
    tool.isMcp === true &&
    requestedHostName === undefined &&
    remoteHostsSlot &&
    isRemoteToolsForwardEnabled()
  ) {
    const mcpRawName = tool.mcpInfo?.toolName ?? tool.name
    const passEntry = remoteHostsSlot.passthroughHost(mcpRawName)
      ? { host: remoteHostsSlot.passthroughHost(mcpRawName)!, wire: mcpRawName }
      : remoteHostsSlot.passthroughHost(tool.name)
        ? {
            host: remoteHostsSlot.passthroughHost(tool.name)!,
            wire: tool.name,
          }
        : undefined
    if (passEntry) {
      hostRoute = resolveRoutedHostForTool(passEntry.host, passEntry.wire, true)
    }
  } else if (tool.remoteExecution?.supported === true) {
    const requested = requestedHostName
    const routedCandidate =
      requested !== undefined &&
      isRemoteToolsForwardEnabled() &&
      remoteHostsSlot !== undefined
        ? remoteHostsSlot.resolve(requested)
        : undefined
    if (
      routedCandidate?.kind === 'remote' &&
      routedCandidate.host.source !== 'session'
    ) {
      hostRoute = resolveRoutedHostForTool(
        routedCandidate.host,
        tool.name,
        false,
      )
    } else {
      const unknown =
        requested !== undefined &&
        isRemoteToolsForwardEnabled() &&
        resolveAnnouncedMachine(requested, toolUseContext.toolState).kind ===
          'unknown'
      if (unknown && requested !== undefined) {
        const already = announceWaitAlreadyExpired(toolUseContext.toolState)
        if (already !== undefined) {
          hostRoute = {
            kind: 'error',
            message: remoteHostGaveUpEarlierMessage(requested, already),
          }
        } else {
          // densable `Gbo` — only an unknown name waits.
          askRemoteToolsReannounce(
            request => {
              void getCurrentStructuredIO()?.requestRemoteToolsReannounce(
                request,
              )
            },
            REMOTE_ANNOUNCE_WAIT_MS,
            toolUseContext.toolState,
          )
          const waited = await waitForAnnouncedMachine(
            requested,
            toolUseContext.abortController.signal,
            REMOTE_ANNOUNCE_WAIT_MS,
            toolUseContext.toolState,
          )
          hostRoute =
            waited === 'gave_up'
              ? {
                  kind: 'error',
                  message: remoteHostGaveUpMessage(
                    requested,
                    announceWaitAlreadyExpired(toolUseContext.toolState) ?? 0,
                  ),
                }
              : remoteHostRoute(
                  toolUse.input,
                  tool.name,
                  getCurrentStructuredIO() !== undefined,
                  toolUseContext.toolState,
                )
        }
      } else {
        hostRoute = remoteHostRoute(
          toolUse.input,
          tool.name,
          getCurrentStructuredIO() !== undefined,
          toolUseContext.toolState,
        )
      }
    }
  }
  if (hostRoute.kind === 'error') {
    const detail = hostRoute.message
    logForDebugging(`remote tool ${toolName}: ${detail}`)
    yield remoteErrorMessage(toolUse.id, detail, assistantMessage.uuid)
    return true
  }

  if (hostRoute.kind === 'routed_host') {
    const { host, wireToolName } = hostRoute
    const hostSource: 'session' | 'bridge' =
      host.source === 'session' ? 'session' : 'bridge'
    const hostMeta = { name: host.name, source: hostSource }
    const rawInputRecord =
      toolUse.input !== null && typeof toolUse.input === 'object'
        ? (toolUse.input as Record<string, unknown>)
        : {}
    const { [REMOTE_TOOL_HOST_FIELD]: _stripHost, ...cleanInput } =
      rawInputRecord
    const ownershipRefusal = checkRemoteTaskStopOwnership(
      tool.name,
      cleanInput,
      host.name,
      hostSource,
      toolUseContext,
    )
    if (ownershipRefusal !== undefined) {
      yield remoteErrorMessage(
        toolUse.id,
        ownershipRefusal,
        assistantMessage.uuid,
      )
      return true
    }
    const deadlineMs =
      host.transport.limits?.defaultDeadlineMs ?? REMOTE_TOOL_DEADLINE_MS
    if (REMOTE_PLUMBING_TOOLS.has(tool.name) && host.transport.callPlumbing) {
      const plumbing = await host.transport.callPlumbing(
        wireToolName,
        cleanInput,
        {
          signal: toolUseContext.abortController.signal,
          deadlineMs,
        },
      )
      if (plumbing?.kind === 'result') {
        const rendered = remoteResultText(
          {
            envelope: plumbing.envelope,
            content: plumbing.content,
            text: plumbing.text,
            is_error: plumbing.isError,
          },
          hostMeta,
        )
        yield {
          message: await buildRemoteSuccessUserMessage({
            tool,
            toolUseId: toolUse.id,
            rendered,
            assistantMessage,
            toolUseContext,
          }),
        }
        return true
      }
      const detail =
        plumbing?.kind === 'cancelled'
          ? REMOTE_HOST_INTERRUPTED
          : remoteToolOutcomeMessage(
              plumbing ?? { kind: 'unreachable' },
              hostMeta,
            )
      yield remoteErrorMessage(toolUse.id, detail, assistantMessage.uuid)
      return true
    }

    const callerRefusal = await checkRemoteSubagentCallerGate({
      tool,
      rawInput: rawInputRecord,
      hostName: host.name,
      source: hostSource,
      toolUseContext,
      canUseTool,
      assistantMessage,
      toolUseId: toolUse.id,
    })
    if (callerRefusal !== undefined) {
      yield remoteErrorMessage(toolUse.id, callerRefusal, assistantMessage.uuid)
      return true
    }

    let effectiveInput = cleanInput
    let sent = await host.transport.call(
      wireToolName,
      effectiveInput,
      { op: 'call', call_id: toolUse.id },
      {
        signal: toolUseContext.abortController.signal,
        deadlineMs,
        toolUseId: toolUse.id,
      },
    )
    let effectiveCallId = toolUse.id
    if (
      sent?.kind === 'result' &&
      sent.envelope &&
      typeof sent.envelope === 'object' &&
      sent.envelope.outcome === 'needs_approval'
    ) {
      const envRec = sent.envelope as Record<string, unknown>
      effectiveCallId =
        typeof envRec.call_id === 'string' ? envRec.call_id : toolUse.id
      const askObj =
        envRec.ask !== null && typeof envRec.ask === 'object'
          ? (envRec.ask as { message?: unknown })
          : undefined
      const approvalResult = await approveRemoteToolCall({
        tool,
        hostName: host.name,
        cleanInput,
        askMessage: askObj?.message ?? envRec.message,
        toolUseContext,
        canUseTool,
        assistantMessage,
        toolUseId: toolUse.id,
      })
      if (approvalResult.kind === 'refused') {
        yield remoteErrorMessage(
          toolUse.id,
          approvalResult.detail,
          assistantMessage.uuid,
        )
        return true
      }
      const approved = approvalResult.kind === 'approved'
      if (approved) {
        effectiveInput = approvalResult.effectiveInput
      }
      sent = await host.transport.call(
        wireToolName,
        effectiveInput,
        {
          op: 'outcome_of',
          call_id: effectiveCallId,
          decision: approved ? 'allow' : 'deny',
          approval: approved
            ? {
                decision: 'allow',
                ...(approvalResult.updatedInput !== undefined && {
                  updated_input: approvalResult.updatedInput,
                }),
                ...(approvalResult.feedback !== undefined && {
                  feedback: approvalResult.feedback,
                }),
              }
            : {
                decision: 'deny',
                ...(approvalResult.feedback !== undefined && {
                  feedback: approvalResult.feedback,
                }),
              },
          ...(approved &&
            approvalResult.updatedInput !== undefined && {
              updatedInput: approvalResult.updatedInput,
            }),
          ...(approvalResult.feedback !== undefined && {
            feedback: approvalResult.feedback,
          }),
        },
        {
          signal: toolUseContext.abortController.signal,
          deadlineMs,
          toolUseId: toolUse.id,
        },
      )
    }
    if (sent?.kind === 'result') {
      const responsePayload = {
        envelope: sent.envelope,
        content: sent.content,
        text: sent.text,
        is_error: sent.isError,
      }
      rememberRemoteBackgroundShell(
        toolUseContext,
        effectiveInput,
        responsePayload,
        host.name,
        effectiveCallId,
      )
      const rendered = remoteResultText(responsePayload, hostMeta)
      yield {
        message: await buildRemoteSuccessUserMessage({
          tool,
          toolUseId: toolUse.id,
          rendered,
          assistantMessage,
          toolUseContext,
        }),
      }
      return true
    }
    const detail =
      sent?.kind === 'cancelled'
        ? REMOTE_HOST_INTERRUPTED
        : sent?.kind === 'approval_unverified'
          ? remoteHostApprovalUnverifiedMessage(host.name)
          : remoteToolOutcomeMessage(sent ?? { kind: 'unreachable' }, hostMeta)
    yield remoteErrorMessage(toolUse.id, detail, assistantMessage.uuid)
    return true
  }

  if (hostRoute.kind === 'remote') {
    const machine = hostRoute.machine
    const inputRecord =
      toolUse.input !== null && typeof toolUse.input === 'object'
        ? (toolUse.input as Record<string, unknown>)
        : {}
    const ownershipRefusal = checkRemoteTaskStopOwnership(
      tool.name,
      inputRecord,
      machine.name,
      machine.source,
      toolUseContext,
    )
    if (ownershipRefusal !== undefined) {
      yield remoteErrorMessage(
        toolUse.id,
        ownershipRefusal,
        assistantMessage.uuid,
      )
      return true
    }
    if (REMOTE_PLUMBING_TOOLS.has(tool.name)) {
      const plumbing = await callRemotePlumbing({
        host: {
          instanceId: machine.instanceId,
          hostName: machine.name,
          stale: machine.stale,
          live: { status: machine.status, lastHeardAt: machine.lastHeardAt },
        },
        name: tool.name,
        args: inputRecord,
        signal: toolUseContext.abortController.signal,
        send: request =>
          getCurrentStructuredIO()?.requestRemotePlumbingCall(request) ??
          Promise.resolve(undefined),
      })
      if (plumbing.kind === 'result') {
        const rendered = remoteResultText(plumbing.response, machine)
        yield {
          message: await buildRemoteSuccessUserMessage({
            tool,
            toolUseId: toolUse.id,
            rendered,
            assistantMessage,
            toolUseContext,
          }),
        }
        return true
      }
      const detail = remoteToolOutcomeMessage(plumbing, machine)
      yield remoteErrorMessage(toolUse.id, detail, assistantMessage.uuid)
      return true
    }
    const callerRefusal = await checkRemoteSubagentCallerGate({
      tool,
      rawInput: inputRecord,
      hostName: machine.name,
      source: machine.source,
      toolUseContext,
      canUseTool,
      assistantMessage,
      toolUseId: toolUse.id,
    })
    if (callerRefusal !== undefined) {
      yield remoteErrorMessage(toolUse.id, callerRefusal, assistantMessage.uuid)
      return true
    }
    const sent = await callRemoteTool({
      host: {
        instanceId: machine.instanceId,
        hostName: machine.name,
        stale: machine.stale,
        live: { status: machine.status, lastHeardAt: machine.lastHeardAt },
      },
      name: tool.name,
      input: inputRecord,
      // densable leg 1 is op "call". call_id is this tool use, so a
      // later outcome_of can name the same call.
      envelope: { op: 'call', call_id: toolUse.id },
      toolUseId: toolUse.id,
      signal: toolUseContext.abortController.signal,
      sentUnderEpoch: machine.epoch,
      send: request =>
        getCurrentStructuredIO()?.requestRemoteToolCall(request, phase => {
          logForDebugging(
            phase === 'not_accepted' || phase === 'indeterminate'
              ? `remote tool ${toolName} post not accepted phase=${phase}`
              : `remote tool ${toolName} upload ${phase}`,
          )
        }) ?? Promise.resolve(undefined),
      probe: async () => {
        const io = getCurrentStructuredIO()
        if (!io) return 'unsent'
        const answer = await io.requestRemoteToolsProbe({
          instanceId: machine.instanceId,
          issuedAt: Date.now(),
          deadlineMs: REMOTE_TOOL_PROBE_CAP_MS,
        })
        const probe = classifyRemoteToolsProbe(answer)
        if (probe === 'answered') {
          const result = answer?.result
          const epoch =
            result !== null &&
            typeof result === 'object' &&
            typeof (result as { epoch?: unknown }).epoch === 'string'
              ? (result as { epoch: string }).epoch
              : undefined
          noteRemoteMachineHeard(
            machine.name,
            epoch,
            toolUseContext.toolState,
            machine.instanceId,
          )
        }
        return probe
      },
      onProbeMissed: () =>
        markRemoteMachineAway(
          machine.name,
          'probe_missed',
          toolUseContext.toolState,
          machine.instanceId,
        ),
      rebind: () => {
        const current = announcedRemoteMachines(toolUseContext.toolState).find(
          item => item.name === machine.name,
        )
        if (!current || current.instanceId === machine.instanceId) {
          return undefined
        }
        return {
          instanceId: current.instanceId,
          hostName: current.name,
          stale: current.stale,
          live: { status: current.status, lastHeardAt: current.lastHeardAt },
        }
      },
    })
    if (sent.kind === 'unreachable' || sent.kind === 'host_gone') {
      markRemoteMachineAway(
        machine.name,
        undefined,
        toolUseContext.toolState,
        machine.instanceId,
      )
    }
    if (sent.kind === 'timed_out') {
      noteHeldRemoteTool(sent, toolName, true)
      const standing = sent.requestId
        ? standingRemoteTool(sent.requestId)
        : undefined
      if (standing) {
        const checked = await checkStandingRemoteTool({
          held: standing,
          name: tool.name,
          callId: toolUse.id,
          signal: toolUseContext.abortController.signal,
          poll: envelope =>
            callRemoteTool({
              host: {
                instanceId: machine.instanceId,
                hostName: machine.name,
                stale: false,
                live: {
                  status: 'online',
                  lastHeardAt: Date.now(),
                },
              },
              name: tool.name,
              input: inputRecord,
              envelope,
              toolUseId: toolUse.id,
              signal: toolUseContext.abortController.signal,
              send: request =>
                getCurrentStructuredIO()?.requestRemoteToolCall(request) ??
                Promise.resolve(undefined),
            }),
        })
        if (checked.kind === 'result') {
          const rendered = remoteResultText(checked.response, machine)
          yield {
            message: await buildRemoteSuccessUserMessage({
              tool,
              toolUseId: toolUse.id,
              rendered,
              assistantMessage,
              toolUseContext,
            }),
          }
          return true
        }
        const detail = remoteToolOutcomeMessage(checked, machine)
        yield remoteErrorMessage(toolUse.id, detail, assistantMessage.uuid)
        return true
      }
    }
    if (sent.kind === 'needs_approval') {
      const envelope =
        sent.response?.envelope !== null &&
        typeof sent.response?.envelope === 'object'
          ? (sent.response.envelope as {
              ask?: { message?: unknown }
              message?: unknown
              call_id?: unknown
            })
          : undefined
      const ask = envelope?.ask?.message ?? envelope?.message
      const callId =
        typeof envelope?.call_id === 'string' ? envelope.call_id : toolUse.id
      const { [REMOTE_TOOL_HOST_FIELD]: _dropHostField, ...cleanRemoteInput } =
        inputRecord
      const approvalResult = await approveRemoteToolCall({
        tool,
        hostName: machine.name,
        cleanInput: cleanRemoteInput,
        askMessage: ask,
        toolUseContext,
        canUseTool,
        assistantMessage,
        toolUseId: toolUse.id,
      })
      if (approvalResult.kind === 'refused') {
        yield remoteErrorMessage(
          toolUse.id,
          approvalResult.detail,
          assistantMessage.uuid,
        )
        return true
      }
      const approved = approvalResult.kind === 'approved'
      const effectiveRemoteInput = approved
        ? approvalResult.effectiveInput
        : cleanRemoteInput
      const again = await callRemoteTool({
        host: {
          instanceId: machine.instanceId,
          hostName: machine.name,
          stale: false,
          live: { status: 'online', lastHeardAt: Date.now() },
        },
        name: tool.name,
        input: effectiveRemoteInput,
        envelope: {
          op: 'outcome_of',
          call_id: callId,
          decision: approved ? 'allow' : 'deny',
          approval: approved
            ? {
                decision: 'allow',
                ...(approvalResult.updatedInput !== undefined && {
                  updated_input: approvalResult.updatedInput,
                }),
                ...(approvalResult.feedback !== undefined && {
                  feedback: approvalResult.feedback,
                }),
              }
            : {
                decision: 'deny',
                ...(approvalResult.feedback !== undefined && {
                  feedback: approvalResult.feedback,
                }),
              },
          ...(approved &&
            approvalResult.updatedInput !== undefined && {
              updatedInput: approvalResult.updatedInput,
            }),
          ...(approvalResult.feedback !== undefined && {
            feedback: approvalResult.feedback,
          }),
        },
        toolUseId: toolUse.id,
        signal: toolUseContext.abortController.signal,
        send: request =>
          getCurrentStructuredIO()?.requestRemoteToolCall(request) ??
          Promise.resolve(undefined),
      })
      if (again.kind === 'timed_out') noteHeldRemoteTool(again, toolName, false)
      if (again.kind === 'result') {
        rememberRemoteBackgroundShell(
          toolUseContext,
          effectiveRemoteInput,
          again.response,
          machine.name,
          callId,
        )
        const rendered = remoteResultText(again.response, machine)
        yield {
          message: await buildRemoteSuccessUserMessage({
            tool,
            toolUseId: toolUse.id,
            rendered,
            assistantMessage,
            toolUseContext,
          }),
        }
        return true
      }
      const detail = remoteToolOutcomeMessage(again, machine)
      yield remoteErrorMessage(toolUse.id, detail, assistantMessage.uuid)
      return true
    }
    if (sent.kind === 'result') {
      rememberRemoteBackgroundShell(
        toolUseContext,
        inputRecord,
        sent.response,
        machine.name,
        toolUse.id,
      )
      const rendered = remoteResultText(sent.response, machine)
      yield {
        message: await buildRemoteSuccessUserMessage({
          tool,
          toolUseId: toolUse.id,
          rendered,
          assistantMessage,
          toolUseContext,
        }),
      }
      return true
    }
    if (sent.kind === 'cancelled') {
      const detail = REMOTE_HOST_INTERRUPTED
      yield remoteErrorMessage(toolUse.id, detail, assistantMessage.uuid)
      return true
    }
    {
      const detail = remoteToolOutcomeMessage(sent, machine)
      logForDebugging(
        `remote tool ${toolName} on ${machine.name}: ${sent.detail ?? sent.kind}`,
      )
      yield remoteErrorMessage(toolUse.id, detail, assistantMessage.uuid)
    }
    return true
  }

  return false
}
