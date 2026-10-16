/**
 * densable 2.1.289 Aa skill-inline turn-end (`Z3n` / `vDo` / `nQo` / `oQo` / `CDo`).
 * Semantic names only — never export minify Z3n|vDo|nQo|oQo|CDo.
 */
import type { Message } from '../../types/message.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'

export type SkillInlineHandOffCommand = { tool: string; command: string }

type PromptShellHandOffBag = {
  agentId: string | null
  commands: SkillInlineHandOffCommand[]
}

/** densable `tQo` — GB default true; `k(tQo,!0)!==!1`. */
export function isSkillInlineCommandHandoffEnabled(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_glowing_orbit', true) !== false
  )
}

function isToolResultUserMessage(message: Message): boolean {
  if (message.type !== 'user') return false
  const content = message.message?.content
  if (typeof content === 'string') return false
  if (!Array.isArray(content)) return false
  return content.some(
    block =>
      typeof block === 'object' &&
      block !== null &&
      (block as { type?: unknown }).type === 'tool_result',
  )
}

/**
 * densable `vDo` — last real user index (promptSource, or non-meta
 * non-stackedExpansion non-tool_result). stackedExpansion is gold's field;
 * local slash stacked host is invent-ban — only read if present.
 */
export function findLastRealUserMessageIndex(messages: Message[]): number {
  const idx = messages.findLastIndex(message => {
    if (message.type !== 'user') return false
    const bag = message as Message & {
      promptSource?: unknown
      stackedExpansion?: unknown
    }
    if (bag.promptSource !== undefined) return true
    return (
      message.isMeta !== true &&
      bag.stackedExpansion !== true &&
      !isToolResultUserMessage(message)
    )
  })
  return Math.max(idx, 0)
}

/**
 * densable `nQo(e,n)` — pending line is a token in the tool_use command.
 */
export function skillInlineCommandContainsPendingLine(
  toolUseCommand: string,
  pendingLine: string,
): boolean {
  const needle = pendingLine.replace(/\s+/g, ' ').trim()
  const haystack = toolUseCommand.replace(/\s+/g, ' ').trim()
  const boundary = /[\s;&|()<>]/
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + 1)
  ) {
    const before = haystack[at - 1]
    const after = haystack[at + needle.length]
    if (
      (before === undefined || boundary.test(before)) &&
      (after === undefined || boundary.test(after))
    ) {
      return true
    }
  }
  return false
}

function promptShellHandOffOf(
  message: Message,
): PromptShellHandOffBag | undefined {
  const bag = (message as { promptShellHandOff?: unknown }).promptShellHandOff
  if (bag === undefined || typeof bag !== 'object' || bag === null) {
    return undefined
  }
  const rec = bag as { agentId?: unknown; commands?: unknown }
  if (!Array.isArray(rec.commands)) return undefined
  return {
    agentId: rec.agentId === undefined ? null : (rec.agentId as string | null),
    commands: rec.commands as SkillInlineHandOffCommand[],
  }
}

/**
 * densable `oQo` / `CDo(e.slice(vDo(e)), o, agentId??null)`.
 * Unrun skill-inline shell commands collected on user promptShellHandOff
 * whose pending lines were not consumed by a matching tool_use.
 */
export function pendingSkillInlineCommands(
  messages: Message[],
  thisTurnAssistants: Message[],
  agentId: string | null,
): SkillInlineHandOffCommand[] {
  const pending = new Map<
    string,
    { entry: SkillInlineHandOffCommand; pending: string[] }
  >()
  for (const message of [...messages, ...thisTurnAssistants]) {
    if (message.type === 'user') {
      const handOff = promptShellHandOffOf(message)
      if (handOff === undefined || handOff.agentId !== agentId) continue
      for (const entry of handOff.commands) {
        const key = `${entry.tool}\n${entry.command}`
        if (!pending.has(key)) {
          pending.set(key, {
            entry,
            pending: entry.command
              .split('\n')
              .filter(line => line.trim() !== ''),
          })
        }
      }
      continue
    }
    if (message.type !== 'assistant' || pending.size === 0) continue
    const content = message.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (
        typeof block !== 'object' ||
        block === null ||
        (block as { type?: unknown }).type !== 'tool_use'
      ) {
        continue
      }
      const input = (block as { input?: unknown }).input
      if (
        typeof input !== 'object' ||
        input === null ||
        !('command' in input) ||
        typeof (input as { command?: unknown }).command !== 'string'
      ) {
        continue
      }
      const toolUseCommand = (input as { command: string }).command
      const toolName = (block as { name?: unknown }).name
      for (const [key, row] of pending) {
        if (row.entry.tool !== toolName) continue
        row.pending = row.pending.filter(
          line => !skillInlineCommandContainsPendingLine(toolUseCommand, line),
        )
        if (row.pending.length === 0) pending.delete(key)
      }
    }
  }
  return [...pending.values()].map(row => row.entry)
}

/**
 * densable Aa `m("skill_inline_command_handoff","not_run")` after handback.
 */
export function maybeLogSkillInlineCommandHandoffNotRun(
  messages: Message[],
  thisTurnAssistants: Message[],
  agentId: string | null | undefined,
): void {
  if (!isSkillInlineCommandHandoffEnabled()) return
  try {
    const from = findLastRealUserMessageIndex(messages)
    const leftover = pendingSkillInlineCommands(
      messages.slice(from),
      thisTurnAssistants,
      agentId ?? null,
    )
    if (leftover.length > 0) {
      logEvent('skill_inline_command_handoff', {
        outcome:
          'not_run' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  } catch (err) {
    logForDebugging(
      `Skill inline command turn-end check failed: ${errorMessage(err)}`,
      { level: 'error' },
    )
  }
}
