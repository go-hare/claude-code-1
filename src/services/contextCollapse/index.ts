// Auto-generated stub — replace with real implementation
import type { Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { QuerySource } from '../../constants/querySource.js'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../utils/sessionHost.js'

export interface ContextCollapseHealth {
  totalSpawns: number
  totalErrors: number
  lastError: string | null
  emptySpawnWarningEmitted: boolean
  totalEmptySpawns: number
}

export interface ContextCollapseStats {
  collapsedSpans: number
  collapsedMessages: number
  stagedSpans: number
  health: ContextCollapseHealth
}

export interface CollapseResult {
  messages: Message[]
}

export interface DrainResult {
  committed: number
  messages: Message[]
}

export const getStats: () => ContextCollapseStats = () => ({
  collapsedSpans: 0,
  collapsedMessages: 0,
  stagedSpans: 0,
  health: {
    totalSpawns: 0,
    totalErrors: 0,
    lastError: null,
    emptySpawnWarningEmitted: false,
    totalEmptySpawns: 0,
  },
})

const contextCollapseSlot = new RootSessionSlot<{ enabled: boolean }>(() => ({
  enabled: false,
}))

export function isContextCollapseEnabled(): boolean {
  return contextCollapseSlot.of(getBootstrapSession()).enabled
}

export const subscribe: (callback: () => void) => () => void =
  (_callback: () => void) => () => {}

export const applyCollapsesIfNeeded: (
  messages: Message[],
  toolUseContext: ToolUseContext,
  querySource: QuerySource,
) => Promise<CollapseResult> = async (messages: Message[]) => ({ messages })

export const isWithheldPromptTooLong: (
  message: Message,
  isPromptTooLongMessage: (msg: Message) => boolean,
  querySource: QuerySource,
) => boolean = () => false

export const recoverFromOverflow: (
  messages: Message[],
  querySource: QuerySource,
) => DrainResult = (messages: Message[]) => ({ committed: 0, messages })

export function resetContextCollapse(): void {
  contextCollapseSlot.of(getBootstrapSession()).enabled = false
}

export function initContextCollapse(): void {
  contextCollapseSlot.of(getBootstrapSession()).enabled = true
}
