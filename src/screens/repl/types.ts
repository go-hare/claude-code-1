import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { AgentColorName } from '@claude-code/builtin-tools/tools/AgentTool/agentColorManager.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type * as React from 'react'
import type { LeftArrowOpenResult } from '../../cli/bg/leftArrowAgents.js'
import type { Command } from '../../commands.js'
import type { HostEngine } from '../../engine/hostEngine.js'
import type { QueryParams } from '../../query.js'
import type { RemoteSessionConfig } from '../../remote/RemoteSessionManager.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../../services/mcp/types.js'
import type { SSHSession } from '../../ssh/createSSHSession.js'
import type { Tool } from '../../Tool.js'
import type { PromptRequest, PromptResponse } from '../../types/hooks.js'
import type {
  HookResultMessage,
  Message as MessageType,
} from '../../types/message.js'
import type { PastedContent } from '../../utils/config.js'
import type { FileHistorySnapshot } from '../../utils/fileHistory.js'
import type { SetAppState } from '../../utils/messageQueueManager.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import type { ContentReplacementRecord } from '../../utils/toolResultStorage.js'

/**
 * Official `RewindBackupsStillCopyingError` (2.1.319 #1752): thrown when /rewind
 * attempts to restore code before `copyFileHistoryForResume` finishes copying
 * backups from the parent/branched session.
 */
export class RewindBackupsStillCopyingError extends Error {
  constructor(
    message = 'File backups from the branched session are still copying — try /rewind again in a moment.',
  ) {
    super(message)
    this.name = 'RewindBackupsStillCopyingError'
  }
}

export const REWIND_COPY_WAIT_MS = 2000

export type Screen = 'prompt' | 'transcript'

export type OpenAgentsPayload = {
  messages?: Array<{
    type: string
    uuid?: string
    isMeta?: boolean
    message?: {
      content?: unknown
      stop_reason?: string | null
    }
  }>
  via?: string
  /** densable Mu confirmedInterstitial — LAc abandon summary was non-empty. */
  confirmedInterstitial?: boolean
  /** densable Mu deferWaitMs — ms spent in defer-then-fork before handoff. */
  deferWaitMs?: number
  /** densable Mu deferCapFired — tengu_defer_cap_ms upgraded to abort-then-fork. */
  deferCapFired?: boolean
  /** densable Mu g8.inflightCount / kinds / restartableCount / partialChars */
  inflightCount?: number
  inflightKinds?: string[]
  restartableCount?: number
  partialChars?: number
  partialText?: string | null
  boundaryUuid?: string
  agentsCount?: number
  checkpoint?: {
    shells?: unknown[]
    cron?: Array<{
      id: string
      cron: string
      prompt: string
      createdAt?: number
      recurring?: boolean
      agentId?: string
      kind?: string
    }>
    agents?: unknown[]
    workflows?: unknown[]
    frameLive?: Array<{ slug: string; writtenAtMs: number; title?: string }>
  }
  liveMonitorSlugs?: string[]
  sessionPermissionRules?: { allow: string[]; deny: string[] }
  memoryToggledOff?: boolean
  /** densable aAf replyOnResume → spawn --reply-on-resume */
  replyOnResume?: boolean
  /** densable aAf abortAfterFlush — main query AbortController */
  abortAfterFlush?: AbortController
  /**
   * densable qpe already ran vHy (openAgentsViaLeftArrow). main skips
   * a second fork and only mounts FleetView (yHy analog).
   */
  alreadyOpened?: LeftArrowOpenResult
}

export type Props = {
  commands: Command[]
  debug: boolean
  initialTools: Tool[]
  // Initial messages to populate the REPL with
  initialMessages?: MessageType[]
  // Deferred hook messages promise — REPL renders immediately and injects
  // hook messages when they resolve. Awaited before the first API call.
  pendingHookMessages?: Promise<HookResultMessage[]>
  initialFileHistorySnapshots?: FileHistorySnapshot[]
  // Content-replacement records from a resumed session's transcript — used to
  // reconstruct contentReplacementState so the same results are re-replaced
  initialContentReplacements?: ContentReplacementRecord[]
  // Initial agent context for session resume (name/color set via /rename or /color)
  initialAgentName?: string
  initialAgentColor?: AgentColorName
  mcpClients?: MCPServerConnection[]
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>
  autoConnectIdeFlag?: boolean
  strictMcpConfig?: boolean
  systemPrompt?: string
  appendSystemPrompt?: string
  /** Official --append-subagent-system-prompt for Task-tool subagents. */
  appendSubagentSystemPrompt?: string
  /** densable 2.1.247 #7 `fallbackModel:g` — --fallback-model for subagents. */
  fallbackModel?: string
  // Optional callback invoked before query execution
  // Called after user message is added to conversation but before API call
  // Return false to prevent query execution
  onBeforeQuery?: (
    input: string,
    newMessages: MessageType[],
  ) => Promise<boolean>
  // Optional callback when a turn completes (model finishes responding)
  onTurnComplete?: (
    messages: MessageType[],
    terminalReason?: string,
  ) => void | Promise<void>
  // When true, disables REPL input (hides prompt and prevents message selector)
  disabled?: boolean
  // Optional agent definition to use for the main thread
  mainThreadAgentDefinition?: AgentDefinition
  // When true, disables all slash commands
  disableSlashCommands?: boolean
  // Task list id: when set, enables tasks mode that watches a task list and auto-processes tasks.
  taskListId?: string
  // Remote session config for --remote mode (uses CCR as execution engine)
  remoteSessionConfig?: RemoteSessionConfig
  // SSH session for `claude ssh` mode (local REPL, remote tools over ssh)
  sshSession?: SSHSession
  // Thinking configuration to use when thinking is enabled
  thinkingConfig: ThinkingConfig
  // Callback to switch to agents/fleet view (left arrow on empty input).
  // Official Sj4/aAf: transcript + mid-turn partial + portable checkpoint.
  onOpenAgents?: (payload?: OpenAgentsPayload) => void
  /**
   * Official resume-return densable — inject a continue prompt once after
   * resume (compact/continue choices). Enqueued as priority next, meta.
   */
  initialAutoContinuePrompt?: string
  /**
   * densable 2.1.218 LHr/Jul Host engine (S8o). When omitted, REPL self-creates
   * via densable `P??S8o` and closes on unmount when self-owned.
   */
  engine?: HostEngine
  /** densable onCommandsChange — Host/CCR command list push. */
  onCommandsChange?: (commands: Command[]) => void
  /** Official onQueryParamsChange supplies the feed reader to an external engine. */
  onQueryParamsChange?: (readPendingQueryParams: () => QueryParams) => void
  /** #1717: Restore persisted SEP-2663 MCP task sidecars once REPL has live setAppState. */
  resumeSep2663Tasks?: {
    sessionId: string
    restore: (params: {
      setAppState: SetAppState
      getMcpClients: () => readonly MCPServerConnection[]
    }) => Promise<unknown>
  }
}

export type ToolJSXState = {
  jsx: React.ReactNode | null
  shouldHidePromptInput: boolean
  shouldContinueAnimation?: true
  showSpinner?: boolean
  isLocalJSXCommand?: boolean
  isImmediate?: boolean
}

export type LocalJSXCommandState = {
  jsx: React.ReactNode | null
  shouldHidePromptInput: boolean
  shouldContinueAnimation?: true
  showSpinner?: boolean
  isLocalJSXCommand: true
}

export type SetToolJSXArgs = {
  jsx: React.ReactNode | null
  shouldHidePromptInput: boolean
  shouldContinueAnimation?: true
  showSpinner?: boolean
  isLocalJSXCommand?: boolean
  clearLocalJSX?: boolean
} | null

export type PromptQueueItem = {
  request: PromptRequest
  title: string
  toolInputSummary?: string | null
  resolve: (response: PromptResponse) => void
  reject: (error: Error) => void
}

export type StashedPrompt = {
  text: string
  cursorOffset: number
  pastedContents: Record<number, PastedContent>
}

export type PkeState =
  | { kind: 'none' }
  | { kind: 'dialog'; node: React.ReactNode }
  | { kind: 'shutting-down' }

export type LeftArrowDeferArm = {
  confirmedInterstitial: boolean
  armedAtMs: number
  lastPressMs: number
  clearCapTimer: () => void
  carriedAtPress: Set<string>
  proceed: () => Promise<string>
}

export type DeferredAdoptResumeRefs = {
  getToolUseContext?: (
    messages: unknown[],
    newMessages: unknown[],
    abort: AbortController,
    model: string,
  ) => unknown
  canUseTool?: (...args: unknown[]) => Promise<unknown> | unknown
  mainLoopModel?: string
  resumeAgentBackground?: (opts: {
    agentId: string
    prompt: string | ContentBlockParam[]
    toolUseContext: unknown
    canUseTool: unknown
    /** Official Aye continueInterruptedTurn — orphan auto-resume EAf gate. */
    continueInterruptedTurn?: boolean
  }) => Promise<
    | {
        agentId?: string
        description?: string
        outputFile?: string
        alreadyCompleted?: boolean
      }
    | unknown
  >
}

export type FocusedInputDialog =
  | 'message-selector'
  | 'left-arrow-confirm'
  | 'worker-sandbox-permission'
  | 'elicitation'
  | 'ultraplan-choice'
  | 'ultraplan-launch'
  | 'remote-callout'
  | 'lsp-recommendation'
  | 'plugin-hint'
  | 'fullscreen-upsell'
  | undefined

export type TipNonGoldOverlay =
  | 'prompt'
  | 'model-switch'
  | 'undercover-callout'
  | 'effort-callout'
  | 'search-extra-tools-hint'
  | 'desktop-upsell'
  | undefined

export type ApiMetricsEntry = {
  ttftMs: number
  firstTokenTime: number
  lastTokenTime: number
  responseLengthBaseline: number
  endResponseLength: number
}

export type SalvageState = {
  apiMessageId: string
  salvageText: string
  exact: boolean
}

export type InsertTextHandle = {
  insert: (text: string) => void
  setInputWithCursor: (value: string, cursor: number) => void
  cursorOffset: number
}
