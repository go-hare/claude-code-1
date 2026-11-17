import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import type { ElicitResult } from 'src/services/mcp/types.js'
import type { HookResultMessage } from 'src/types/message.js'
import type {
  HookCallback,
  PermissionRequestResult,
} from '../../types/hooks.js'
import type { PermissionResult } from '../permissions/PermissionResult.js'
import type { HookCommand } from '../settings/types.js'
import type { FunctionHook } from './sessionHooks.js'

export interface HookBlockingError {
  blockingError: string
  command: string
}

/** Re-export ElicitResult from MCP SDK as ElicitationResponse for backward compat. */
export type ElicitationResponse = ElicitResult

export interface HookResult {
  message?: HookResultMessage
  systemMessage?: string
  blockingError?: HookBlockingError
  outcome: 'success' | 'blocking' | 'non_blocking_error' | 'cancelled'
  /** densable Mo.timedOut — prompt Stop timeout, not parent abort. */
  timedOut?: boolean
  preventContinuation?: boolean
  stopReason?: string
  permissionBehavior?: 'ask' | 'deny' | 'allow' | 'passthrough' | 'defer'
  hookPermissionDecisionReason?: string
  additionalContext?: string
  initialUserMessage?: string
  sessionTitle?: string
  reloadSkills?: boolean
  suppressOriginalPrompt?: boolean
  updatedInput?: Record<string, unknown>
  updatedMCPToolOutput?: unknown
  updatedToolOutput?: unknown
  classifierContext?: string
  legacyMcpRewriteSuppressed?: boolean
  impossible?: boolean
  permissionRequestResult?: PermissionRequestResult
  elicitationResponse?: ElicitationResponse
  watchPaths?: string[]
  elicitationResultResponse?: ElicitationResponse
  retry?: boolean
  /** densable 2.1.222 MessageDisplay */
  displayContent?: string
  /** densable i4 terminalSequence after hxe allowlist. */
  terminalSequence?: string
  hook: HookCommand | HookCallback | FunctionHook
}

export type AggregatedHookResult = {
  message?: HookResultMessage // 插入会话的钩子消息（含系统/附件类），供 UI 与后续轮次展示
  blockingError?: HookBlockingError // 致命阻塞：附带命令与错误文案，调用方应中止当前工具/流程
  preventContinuation?: boolean // 为 true 时请求不再继续后续对话轮次（与 stopReason 配套）
  stopReason?: string // 停止继续时的可读原因，用于日志、遥测或向用户解释为何结束
  hookPermissionDecisionReason?: string // 钩子对权限决策的补充说明，常与 permissionBehavior 一同产出
  hookSource?: string // 产生本次权限/改参结果的定义来源（如 settings 与 policy 合并后的条目来源）
  permissionBehavior?: PermissionResult['behavior'] | 'defer' // 多钩并行时按 deny > defer > ask > allow 聚合后的权限行为
  updatedToolOutput?: unknown
  classifierContexts?: Array<{ value: string; hostPrincipal: boolean }>
  pairedRewrite?: 'direct' | 'legacy_mcp' | 'suppressed' | 'none'
  impossible?: boolean
  additionalContexts?: string[] // 注入模型上下文的补充片段（如 UserPromptSubmit），可与多条钩子结果合并
  initialUserMessage?: string // 会话启动等场景预置的首条用户侧文案，供首轮上下文使用
  sessionTitle?: string // SessionStart / UserPromptSubmit 设置的会话标题
  reloadSkills?: boolean // SessionStart 请求重扫 skill/command 目录
  suppressOriginalPrompt?: boolean // UserPromptSubmit / UserPromptExpansion block 时是否省略原始 prompt
  updatedInput?: Record<string, unknown> // 钩子改写后的工具入参；可在 allow/ask 时与权限一起产出，也可单独改参
  updatedMCPToolOutput?: unknown // PostToolUse 钩子对 MCP 工具原始输出的替换内容
  permissionRequestResult?: PermissionRequestResult // PermissionRequest 事件钩子的 allow/deny 及可选改参
  watchPaths?: string[] // SessionStart 等声明的监视路径，供文件变更相关逻辑使用
  elicitationResponse?: ElicitationResponse // Elicitation 钩子的交互/采集结果（MCP elicit 流程）
  elicitationResultResponse?: ElicitationResponse // ElicitationResult 钩子对上一轮引导的后续响应数据
  retry?: boolean // PermissionDenied 等场景是否建议用户重试当前操作
  /** densable 2.1.222 MessageDisplay — hookSpecificOutput.displayContent */
  displayContent?: string
  /** densable ae.hook — Stop goal matching (`prompt === activeGoal.condition`). */
  hook?: HookCommand | HookCallback | FunctionHook
  /** densable ae.timedOut — prompt Stop timeout (parent abort is not a timeout). */
  timedOut?: boolean
}

export type HookOutsideReplResult = {
  command: string
  succeeded: boolean
  output: string
  blocked: boolean
  cancelled?: boolean
  exitCode?: number
  watchPaths?: string[]
  systemMessage?: string
}

export type HookCommandResult = {
  stdout: string
  stderr: string
  output: string
  status: number
  aborted?: boolean
  backgrounded?: boolean
  spawnFailed?: boolean
  exitedNormally?: boolean
  stdioIncomplete?: boolean
  stdioClosedWithoutEnd?: boolean
}
