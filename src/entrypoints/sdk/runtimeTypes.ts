/**
 * Stub: SDK Runtime Types (not yet published in open-source).
 * Non-serializable types: callbacks, interfaces with methods.
 *
 * `tool` / `createSdkMcpServer` live in `createSdkMcpServer.ts` and are
 * re-exported from `agentSdkTypes.ts` (densable fVp / agent-sdk hl product).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import type { CallToolResult, ToolAnnotations } from 'src/services/mcp/types.js'

export type AnyZodRawShape = Record<string, unknown>
export type InferShape<T extends AnyZodRawShape> = { [K in keyof T]: unknown }

export type ForkSessionOptions = {
  dir?: string
  upToMessageId?: string
  title?: string
}
export type ForkSessionResult = { sessionId: string }
export type GetSessionInfoOptions = { dir?: string }
export type GetSessionMessagesOptions = {
  dir?: string
  limit?: number
  offset?: number
  includeSystemMessages?: boolean
}
export type ListSessionsOptions = {
  dir?: string
  limit?: number
  offset?: number
}
export type SessionMutationOptions = { dir?: string }
export type SessionMessage = {
  role: string
  content: unknown
  [key: string]: unknown
}

export interface SDKSession {
  sessionId: string
  prompt(input: string | AsyncIterable<unknown>): Promise<unknown>
  abort(): void
  [key: string]: unknown
}

export type SDKSessionOptions = {
  model?: string
  systemPrompt?: string
  [key: string]: unknown
}

/** densable/agent-sdk SdkMcpToolDefinition — output of `tool()`. */
export interface SdkMcpToolDefinition<
  // biome-ignore lint/suspicious/noExplicitAny: agent-sdk uses any for schema variance
  T extends AnyZodRawShape = any,
> {
  name: string
  description: string
  inputSchema: T
  handler: (args: InferShape<T>, extra: unknown) => Promise<CallToolResult>
  annotations?: ToolAnnotations
  _meta?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * densable/agent-sdk return of `createSdkMcpServer`.
 * Wire shape: `{ type: 'sdk', name, instance }` where instance is McpServer.
 */
export type McpSdkServerConfigWithInstance = {
  type: 'sdk'
  name: string
  instance: McpServer
  version?: string
  tools?: SdkMcpToolDefinition[]
  [key: string]: unknown
}

export interface Options {
  model?: string
  systemPrompt?: string
  [key: string]: unknown
}

export interface InternalOptions extends Options {
  [key: string]: unknown
}

export interface Query {
  [Symbol.asyncIterator](): AsyncIterator<unknown>
  [key: string]: unknown
}

export interface InternalQuery extends Query {
  [key: string]: unknown
}
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
