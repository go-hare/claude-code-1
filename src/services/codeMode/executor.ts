/**
 * Code Mode (2.1.323 #1964) JavaScript VM runtime & session resume planner.
 *
 * Allows Claude to write JavaScript that calls its available tools
 * (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, Agent, MCP tools, etc.)
 * through the session's permission pipeline (`canUseTool`) inside a sandboxed
 * Node `vm` context.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import * as vm from 'node:vm'
import { setCwdState } from '../../bootstrap/state.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import { getCwd } from '../../utils/cwd.js'
import { McpAuthError } from '../mcp/connectionHelpers.js'
import { mcpInfoFromString } from '../mcp/mcpStringUtils.js'
import {
  CODE_MODE_EXPERIMENTAL_NAME,
  CODE_MODE_NAME,
  REPL_MAX_TIMEOUT_MS,
  REPL_SCRIPT_FILENAME,
  REPL_SYNC_RUN_MS,
  REPL_TOOL_CALL_CAP,
} from './constants.js'
import {
  codeModeBeforePin,
  codeModeRefusalReasonText,
  formatCodeModeCommand,
  getCodeModeOptInState,
  isCodeModeEnabled,
  noteReplContextCreated,
  pinCodeMode,
  unpinCodeMode,
} from './optIn.js'

export type CodeModeExecutionResult = {
  result: string
  tool_calls: number
  /** Official 2.1.325 #2315: extra text typed with Yes at permission/plan dialogs. */
  userFeedback?: string[]
}

/**
 * Official 2.1.325 #2314: expand leading `~` / `~/` / `~\` against `homedir()`
 * and resolve relative paths against the live working directory (`getCwd()`,
 * which follows `EnterWorktree` / `ExitWorktree`), preventing `~` paths from
 * being written literally inside the project directory.
 */
export function expandCodeModePath(
  rawPath: string,
  cwd: string = getCwd(),
  home: string = homedir(),
): string {
  if (rawPath === '~') {
    return home
  }
  if (rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return join(home, rawPath.slice(2))
  }
  if (isAbsolute(rawPath)) {
    return rawPath
  }
  return resolve(cwd, rawPath)
}

const CODE_MODE_PATH_KEYS: ReadonlySet<string> = new Set([
  'file_path',
  'path',
  'notebook_path',
])

const CODE_MODE_PATH_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'NotebookEdit',
])

/**
 * Official 2.1.325 #2314: normalize path arguments (`~` expansion + live
 * worktree cwd resolution) for file-oriented tools called from Code Mode.
 */
export function normalizeCodeModeToolInput(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string = getCwd(),
  home: string = homedir(),
): Record<string, unknown> {
  if (!CODE_MODE_PATH_TOOLS.has(toolName)) {
    return input
  }
  let changed = false
  const next: Record<string, unknown> = { ...input }
  for (const key of CODE_MODE_PATH_KEYS) {
    const val = next[key]
    if (typeof val === 'string' && val.length > 0) {
      const expanded = expandCodeModePath(val, cwd, home)
      if (expanded !== val) {
        next[key] = expanded
        changed = true
      }
    }
  }
  return changed ? next : input
}

/**
 * Official 2.1.325 #2314: extract a worktree path from an `EnterWorktree`
 * tool result so Code Mode follows the newly entered worktree immediately.
 */
export function extractEnteredWorktreePath(
  toolName: string,
  data: unknown,
): string | undefined {
  if (toolName !== 'EnterWorktree' || !data || typeof data !== 'object') {
    return undefined
  }
  const rec = data as Record<string, unknown>
  if (typeof rec.worktreePath === 'string' && rec.worktreePath.length > 0) {
    return rec.worktreePath
  }
  if (typeof rec.path === 'string' && rec.path.length > 0) {
    return rec.path
  }
  return undefined
}

/**
 * Official 2.1.325 #2314: when an MCP tool call inside Code Mode fails with an
 * expired sign-in (`McpAuthError`), mark that MCP server as `needs-auth` in
 * AppState so `/mcp` reflects its expired status instead of showing `connected`.
 */
export function syncExpiredMcpAuthInCodeMode(
  toolName: string,
  error: unknown,
  setAppState: ToolUseContext['setAppState'],
): string | undefined {
  const serverName =
    error instanceof McpAuthError
      ? error.serverName
      : error instanceof Error &&
          /requires re-authorization|token expired|needs-auth/i.test(
            error.message,
          )
        ? mcpInfoFromString(toolName)?.serverName
        : undefined
  if (!serverName) return undefined
  setAppState(prev => {
    const idx = prev.mcp.clients.findIndex(c => c.name === serverName)
    if (idx === -1) return prev
    const existing = prev.mcp.clients[idx]!
    if (existing.type === 'needs-auth') return prev
    const nextClients = [...prev.mcp.clients]
    nextClients[idx] = {
      name: existing.name,
      type: 'needs-auth',
      config: existing.config,
    }
    return {
      ...prev,
      mcp: {
        ...prev.mcp,
        clients: nextClients,
      },
    }
  })
  return serverName
}

/**
 * Official 2.1.325 #2315: extract words typed by the user alongside a "Yes"
 * permission approval or plan approval (`ExitPlanMode`) so Code Mode forwards
 * them back to Claude.
 */
export function extractApprovalUserFeedback(
  permission: unknown,
  toolResultData?: unknown,
): string | undefined {
  const parts: string[] = []
  if (permission && typeof permission === 'object') {
    const p = permission as Record<string, unknown>
    for (const key of [
      'userFeedback',
      'approvalFeedback',
      'feedback',
    ] as const) {
      const v = p[key]
      if (typeof v === 'string' && v.trim().length > 0) {
        parts.push(v.trim())
      }
    }
    // Some permission dialogs carry typed allow-with-message on `message`
    if (
      p.behavior === 'allow' &&
      typeof p.message === 'string' &&
      p.message.trim().length > 0
    ) {
      parts.push(p.message.trim())
    }
  }
  if (toolResultData && typeof toolResultData === 'object') {
    const d = toolResultData as Record<string, unknown>
    for (const key of ['userFeedback', 'feedback', 'approvalNote'] as const) {
      const v = d[key]
      if (typeof v === 'string' && v.trim().length > 0) {
        parts.push(v.trim())
      }
    }
  }
  if (parts.length === 0) return undefined
  return [...new Set(parts)].join('\n')
}

export type CodeModeToolInvoker = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<unknown>

export type ExecuteCodeModeScriptOptions = {
  code: string
  invokeTool: CodeModeToolInvoker
  timeoutMs?: number
  toolCallCap?: number
  signal?: AbortSignal
}

const PRIMITIVE_SHORTHAND_MAP: ReadonlyArray<readonly [string, string]> = [
  ['read', 'Read'],
  ['write', 'Write'],
  ['edit', 'Edit'],
  ['glob', 'Glob'],
  ['grep', 'Grep'],
  ['bash', 'Bash'],
  ['notebookEdit', 'NotebookEdit'],
  ['agent', 'Agent'],
]

function formatValueForOutput(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Executes a JavaScript snippet inside an isolated VM context, exposing async
 * bindings for primitive tools and `callTool(name, input)`.
 */
export async function executeCodeModeScript(
  options: ExecuteCodeModeScriptOptions,
): Promise<CodeModeExecutionResult> {
  const {
    code,
    invokeTool,
    timeoutMs = REPL_SYNC_RUN_MS,
    toolCallCap = REPL_TOOL_CALL_CAP,
    signal,
  } = options

  noteReplContextCreated()

  const clampedTimeout = Math.max(100, Math.min(timeoutMs, REPL_MAX_TIMEOUT_MS))
  const logs: string[] = []
  let toolCalls = 0

  const guardedCall = async (
    toolName: string,
    input: Record<string, unknown> = {},
  ): Promise<unknown> => {
    if (signal?.aborted) {
      throw new Error('Code Mode script aborted')
    }
    if (++toolCalls > toolCallCap) {
      throw new Error(
        `Code Mode tool call limit reached (${toolCallCap} calls)`,
      )
    }
    return await invokeTool(toolName, input)
  }

  const sandbox: Record<string, unknown> = {
    console: {
      log: (...args: unknown[]) =>
        logs.push(args.map(a => formatValueForOutput(a)).join(' ')),
      warn: (...args: unknown[]) =>
        logs.push(args.map(a => formatValueForOutput(a)).join(' ')),
      error: (...args: unknown[]) =>
        logs.push(args.map(a => formatValueForOutput(a)).join(' ')),
    },
    callTool: guardedCall,
    JSON,
    Math,
    Date,
    RegExp,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    Promise,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    encodeURIComponent,
    decodeURIComponent,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  }

  for (const [fnName, toolName] of PRIMITIVE_SHORTHAND_MAP) {
    sandbox[fnName] = (input: Record<string, unknown> = {}) =>
      guardedCall(toolName, input)
  }

  const context = vm.createContext(sandbox)
  const wrappedSource = `(async () => {\n${code}\n})()`

  try {
    const script = new vm.Script(wrappedSource, {
      filename: REPL_SCRIPT_FILENAME,
    })
    const runPromise = Promise.resolve(
      script.runInContext(context, { timeout: clampedTimeout }),
    )
    // Suppress unhandledRejection if runPromise rejects after timeout/abort wins the race.
    void runPromise.catch(() => {})

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    const raced = await Promise.race([
      runPromise,
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(`Code Mode script timed out after ${clampedTimeout}ms`),
          )
        }, clampedTimeout)
        if (typeof timeoutHandle.unref === 'function') {
          timeoutHandle.unref()
        }
      }),
      ...(signal
        ? [
            new Promise<never>((_resolve, reject) => {
              if (signal.aborted) {
                reject(new Error('Code Mode script aborted'))
                return
              }
              onAbort = () => reject(new Error('Code Mode script aborted'))
              signal.addEventListener('abort', onAbort, { once: true })
            }),
          ]
        : []),
    ]).finally(() => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      if (onAbort !== undefined) {
        signal?.removeEventListener('abort', onAbort)
      }
    })

    const outputParts: string[] = [...logs]
    if (raced !== undefined) {
      outputParts.push(formatValueForOutput(raced))
    }
    return {
      result: outputParts.join('\n') || '(completed with no output)',
      tool_calls: toolCalls,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const prefix = logs.length > 0 ? `${logs.join('\n')}\n` : ''
    return {
      result: `${prefix}Error: ${message}`,
      tool_calls: toolCalls,
    }
  }
}

/**
 * Wraps the base `REPLTool` so that when Code Mode is active, `call()` executes
 * JavaScript in the VM sandbox and routes every nested tool invocation through
 * `canUseTool` + the target tool's `call()` implementation.
 */
export function wrapReplToolForCodeMode(
  baseReplTool: Tool,
  resolveAvailableTools: () => readonly Tool[],
): Tool {
  return {
    ...baseReplTool,
    async call(
      input: { code: string },
      context: ToolUseContext,
      canUseTool: CanUseToolFn,
      parentMessage: AssistantMessage,
    ) {
      if (!isCodeModeEnabled()) {
        return await baseReplTool.call(
          input as never,
          context,
          canUseTool,
          parentMessage,
        )
      }

      const collectedFeedback: string[] = []
      let activeCwd = getCwd()

      const execution = await executeCodeModeScript({
        code: input.code,
        signal: context.abortController.signal,
        invokeTool: async (toolName, rawInput) => {
          const allTools = [
            ...resolveAvailableTools(),
            ...(context.options?.tools ?? []),
          ]
          const target = allTools.find(
            t => t.name === toolName && t.name !== baseReplTool.name,
          )
          if (!target) {
            throw new Error(`Tool not available in Code Mode: ${toolName}`)
          }
          // Official 2.1.325 #2314: always read live cwd (follows EnterWorktree)
          // and expand `~` / relative paths against it before schema validation.
          activeCwd = getCwd() || activeCwd
          const normalizedInput = normalizeCodeModeToolInput(
            toolName,
            rawInput,
            activeCwd,
          )
          const parsed = target.inputSchema.safeParse(normalizedInput)
          if (!parsed.success) {
            throw new Error(
              `Invalid input for ${toolName}: ${parsed.error.message}`,
            )
          }
          const permission = await canUseTool(
            target,
            parsed.data as Record<string, unknown>,
            context,
            parentMessage,
            `${context.toolUseId ?? 'repl'}:${toolName}`,
          )
          if (permission.behavior !== 'allow') {
            throw new Error(
              permission.message ?? `Permission denied for ${toolName}`,
            )
          }
          const finalInput = normalizeCodeModeToolInput(
            toolName,
            (permission.updatedInput as Record<string, unknown> | undefined) ??
              (parsed.data as Record<string, unknown>),
            activeCwd,
          )
          let out: { data: unknown }
          try {
            out = await target.call(
              finalInput as never,
              context,
              canUseTool,
              parentMessage,
            )
          } catch (callErr) {
            // Official 2.1.325 #2314: sync expired MCP server auth to /mcp.
            syncExpiredMcpAuthInCodeMode(toolName, callErr, context.setAppState)
            throw callErr
          }
          // Official 2.1.325 #2314: follow newly entered worktree immediately.
          const enteredWorktree = extractEnteredWorktreePath(toolName, out.data)
          if (enteredWorktree) {
            activeCwd = enteredWorktree
            setCwdState(enteredWorktree)
          }
          // Official 2.1.325 #2315: forward words typed with Yes at permission
          // dialog or plan approval back to Claude.
          const feedback = extractApprovalUserFeedback(permission, out.data)
          if (feedback) {
            collectedFeedback.push(feedback)
          }
          return out.data
        },
      })

      if (collectedFeedback.length > 0) {
        const feedbackBlock = collectedFeedback
          .map(f => `[User feedback]: ${f}`)
          .join('\n')
        return {
          data: {
            ...execution,
            result: execution.result
              ? `${execution.result}\n\n${feedbackBlock}`
              : feedbackBlock,
            userFeedback: collectedFeedback,
          },
        }
      }

      return { data: execution }
    },
  }
}

export type CodeModeResumePlan = {
  pin?: boolean
  unpin?: boolean
  switched: boolean
  refused?: string
  refusedWhy?: string
  /**
   * Official 2.1.325 #2316: true when the resumed session ended mid-Code Mode
   * script — the host MUST wait for the user's next prompt instead of
   * auto-continuing the turn on resume.
   */
  waitForNextPrompt?: boolean
}

type ResumedTranscriptMessageLike = {
  type?: string
  message?: {
    role?: string
    content?: unknown
  }
}

/**
 * Official 2.1.325 #2316: detect whether a resumed session's transcript ended
 * while a Code Mode (`REPL`) script was still in flight (an assistant
 * `tool_use` for `REPL` with no completed `tool_result`, or a trailing
 * interrupted `REPL` tool_result). When true, resuming must NOT auto-start a
 * model turn — it must wait for the user's next prompt.
 */
export function didSessionEndDuringCodeModeScript(
  messages: readonly ResumedTranscriptMessageLike[] | undefined,
): boolean {
  if (!messages || messages.length === 0) return false
  const pendingReplToolUseIds = new Set<string>()
  let lastMeaningfulWasInterruptedRepl = false

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue
    if (msg.type === 'assistant') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === 'object' &&
            (block as { type?: unknown }).type === 'tool_use' &&
            (block as { name?: unknown }).name === 'REPL' &&
            typeof (block as { id?: unknown }).id === 'string'
          ) {
            pendingReplToolUseIds.add((block as { id: string }).id)
          }
        }
      }
      lastMeaningfulWasInterruptedRepl = false
    } else if (msg.type === 'user') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        let sawReplResult = false
        let sawInterruptedRepl = false
        let sawNonResultUserText = false
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          const rec = block as {
            type?: unknown
            tool_use_id?: unknown
            is_error?: unknown
            content?: unknown
          }
          if (
            rec.type === 'tool_result' &&
            typeof rec.tool_use_id === 'string'
          ) {
            if (pendingReplToolUseIds.has(rec.tool_use_id)) {
              sawReplResult = true
              pendingReplToolUseIds.delete(rec.tool_use_id)
              const text =
                typeof rec.content === 'string'
                  ? rec.content
                  : JSON.stringify(rec.content ?? '')
              if (
                rec.is_error === true &&
                /interrupt|abort|ended/i.test(text)
              ) {
                sawInterruptedRepl = true
              }
            }
          } else if (rec.type === 'text') {
            sawNonResultUserText = true
          }
        }
        if (sawNonResultUserText) {
          lastMeaningfulWasInterruptedRepl = false
        } else if (sawReplResult) {
          lastMeaningfulWasInterruptedRepl = sawInterruptedRepl
        }
      } else if (typeof content === 'string' && content.trim().length > 0) {
        lastMeaningfulWasInterruptedRepl = false
      }
    }
  }

  return pendingReplToolUseIds.size > 0 || lastMeaningfulWasInterruptedRepl
}

/**
 * Official `planCodeModeFromSession` (`chunk-w140y4g2`): determines how to
 * reconcile the current Code Mode opt-in state with a resumed session's
 * `replMode` flag, and whether to wait for the user's next prompt (#2316).
 */
export function planCodeModeFromSession(
  session: {
    replMode?: boolean
    sessionId?: string
    headless?: boolean
    withinSession?: boolean
    messages?: readonly ResumedTranscriptMessageLike[]
  },
  onNotice?: (message: string) => void,
): CodeModeResumePlan {
  const canRun = codeModeBeforePin()
  const isResumedCodeMode = session.replMode === true
  const waitForNextPrompt =
    isResumedCodeMode && didSessionEndDuringCodeModeScript(session.messages)

  if (!canRun) {
    if (!isResumedCodeMode) {
      return { pin: undefined, switched: false }
    }
    const optIn = getCodeModeOptInState()
    const base = `This session was started in ${CODE_MODE_EXPERIMENTAL_NAME}`
    if (optIn.state === 'refused') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which ${codeModeRefusalReasonText(optIn.why)}, so it can't be resumed.`,
        refusedWhy: `opt_in_refused_${optIn.why}`,
      }
    }
    if (optIn.state === 'not_asked' && optIn.turnedOffIn === 'managed') {
      return {
        pin: undefined,
        switched: false,
        refused: `${base}, which your organization's settings don't allow, so it can't be resumed.`,
        refusedWhy: 'opt_in_off_managed',
      }
    }
    const resumeArg = session.sessionId
      ? `--resume ${session.sessionId}`
      : undefined
    return {
      pin: undefined,
      switched: false,
      refused: `${base}, which is off, so it can't be resumed.\nTo resume it, ${session.withinSession ? 'exit and ' : ''}${formatCodeModeCommand(1, resumeArg, 'step')}.`,
      refusedWhy: session.headless ? 'not_asked_headless' : 'not_asked',
    }
  }

  const currentlyOn = isCodeModeEnabled()
  if (!isResumedCodeMode) {
    onNotice?.(
      `${CODE_MODE_NAME} is on, but this session isn't using it, so it continues with the ordinary tools. New sessions use ${CODE_MODE_NAME}.`,
    )
    return currentlyOn
      ? { pin: false, switched: true }
      : { pin: undefined, switched: false }
  }
  return currentlyOn
    ? {
        pin: undefined,
        switched: false,
        ...(waitForNextPrompt ? { waitForNextPrompt: true } : {}),
      }
    : {
        pin: undefined,
        unpin: true,
        switched: true,
        ...(waitForNextPrompt ? { waitForNextPrompt: true } : {}),
      }
}

/**
 * Official `applyCodeModePlan`: pins or unpins Code Mode for a resumed session.
 */
export function applyCodeModePlan(plan: CodeModeResumePlan): void {
  if (plan.unpin) {
    unpinCodeMode()
  } else if (plan.pin !== undefined) {
    pinCodeMode(plan.pin)
  }
}

/**
 * Official `cloudMoveRefusal`: blocks moving an active Code Mode session to the cloud.
 */
export function cloudMoveRefusal(): string | undefined {
  if (isCodeModeEnabled()) {
    return `This session was started in ${CODE_MODE_EXPERIMENTAL_NAME}, which the move to the cloud can't carry yet, so it can't continue in the cloud.`
  }
  return undefined
}
