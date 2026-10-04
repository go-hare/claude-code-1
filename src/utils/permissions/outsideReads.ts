import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/constants.js'
import { GLOB_TOOL_NAME } from '@claude-code/builtin-tools/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '@claude-code/builtin-tools/tools/GrepTool/prompt.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import {
  getEnabledSettingSources,
  isSettingSourceEnabled,
} from '../settings/constants.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { SandboxManager } from '../sandbox/sandbox-adapter.js'
import { isAutoModeActive } from './autoModeState.js'
import { isBgSession } from '../concurrentSessions.js'
import { isTeammate } from '../teammate.js'
import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionAskDecision } from '../../types/permissions.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

/** official jx */
export const OUTSIDE_READS_BLOCKED_REASON =
  'Reads outside the working directories are blocked (permissions.blockReadsOutsideWorkingDirectories). Add the directory with /add-dir, or remove that setting.'

export const AUTO_MODE_OUTSIDE_READS_KIND = 'auto_mode_outside_reads' as const

export const OUTSIDE_READS_DIALOG_TITLE =
  'Read outside the working directories,'
export const OUTSIDE_READS_DIALOG_QUESTION =
  'Allow reads outside the working directories?'

export const OUTSIDE_READS_OPTION_ALLOW =
  'Yes, keep allowing reads outside the working directories'
export const OUTSIDE_READS_OPTION_BLOCK =
  'No, block reads outside the working directories from now on'
export const OUTSIDE_READS_OPTION_ASK_AGAIN = 'No, ask again next time'

export const OUTSIDE_READS_CHOICES = ['allow', 'block', 'ask_again'] as const
export type OutsideReadsChoice = (typeof OUTSIDE_READS_CHOICES)[number]

export const OUTSIDE_READS_OPTION_LABELS: Record<OutsideReadsChoice, string> = {
  allow: OUTSIDE_READS_OPTION_ALLOW,
  block: OUTSIDE_READS_OPTION_BLOCK,
  ask_again: OUTSIDE_READS_OPTION_ASK_AGAIN,
}

const FILE_TOOLS_OFFERING_OUTSIDE_READ_BLOCK = new Set([
  FILE_READ_TOOL_NAME,
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
])

/** official tke() */
export function settingsHaveBlockReadsOutsideWorkingDirectories(): boolean {
  return getEnabledSettingSources().some(
    source =>
      getSettingsForSource(source)?.permissions
        ?.blockReadsOutsideWorkingDirectories === true,
  )
}

export function contextBlocksOutsideReads(context: {
  blockReadsOutsideWorkingDirectories?: boolean
}): boolean {
  return context.blockReadsOutsideWorkingDirectories === true
}

export function isOutsideReadFileToolName(toolName: string): boolean {
  return FILE_TOOLS_OFFERING_OUTSIDE_READ_BLOCK.has(toolName)
}

/** official Jnr */
export function outsideReadsExplainer(sandboxFenced: boolean): string {
  return (
    'Auto mode and the sandbox read outside the working directories without asking. Yes or Block settles this question; Ask again asks on the next outside read. Block: the file tools refuse reads outside the working directories in every project. ' +
    (sandboxFenced
      ? 'Sandboxed commands lose your home directory (SSH keys, home-installed tools) until you re-open paths with sandbox.filesystem.allowRead.'
      : 'Sandboxed commands are not changed on this machine (the sandbox is off, its filesystem rules are relaxed, a managed read-path lock is on, or the working directory name has glob characters).') +
    ' To undo, remove permissions.blockReadsOutsideWorkingDirectories from your user settings; file tools follow next session, sandboxed commands at once.'
  )
}

/** official go() */
export function outsideReadsDialogPayload(input: {
  toolName: string
  path: string
  sandboxFenced: boolean
}): {
  toolName: string
  path: string
  title: string
  question: string
  explainer: string
  options: Array<{ value: OutsideReadsChoice; label: string }>
} {
  return {
    toolName: input.toolName,
    path: input.path,
    title: OUTSIDE_READS_DIALOG_TITLE,
    question: OUTSIDE_READS_DIALOG_QUESTION,
    explainer: outsideReadsExplainer(input.sandboxFenced),
    options: OUTSIDE_READS_CHOICES.map(value => ({
      value,
      label: OUTSIDE_READS_OPTION_LABELS[value],
    })),
  }
}

export function blockedOutsideReadFileToolMessage(path: string): string {
  return `${path} is outside the working directories; reads outside them are blocked (permissions.blockReadsOutsideWorkingDirectories).`
}

export function blockedOutsideReadUserChoiceMessage(opts?: {
  saveError?: string
  sandboxRefreshed?: boolean
}): string {
  let message =
    'The user chose to block reads outside the working directories (permissions.blockReadsOutsideWorkingDirectories). Ask the user to add the directory with /add-dir, or to remove that setting.'
  if (opts?.saveError) {
    message += ` Tell the user: the setting could not be saved to user settings (${opts.saveError}); the file tools are fenced for this session only, sandboxed commands are not.`
  } else if (opts && opts.sandboxRefreshed === false) {
    message +=
      ' Tell the user: the setting is saved, but sandboxed commands may not be fenced until the settings change is picked up.'
  }
  return message
}

/** official W() ask-again decisionReason.reason */
export const OUTSIDE_READS_ASK_AGAIN_REASON =
  'outside read declined, ask again next time'

export function outsideReadAskAgainMessage(feedback?: string): string {
  return feedback
    ? `The user did not allow this read outside the working directories: ${feedback}`
    : 'The user did not allow this read outside the working directories.'
}

/**
 * official W() DualInk deny without blockOutsideReads → ask (not cancelAndAbort).
 */
export function outsideReadAskAgainDecision(opts?: {
  feedback?: string
  contentBlocks?: ContentBlockParam[]
}): PermissionAskDecision {
  const feedback = opts?.feedback
  return {
    behavior: 'ask',
    message: outsideReadAskAgainMessage(feedback),
    decisionReason: {
      type: 'other',
      reason: OUTSIDE_READS_ASK_AGAIN_REASON,
    },
    ...(opts?.contentBlocks ? { contentBlocks: opts.contentBlocks } : {}),
    ...(feedback ? { userFeedback: feedback } : {}),
  }
}

export function blockedOutsideReadCwdMoveMessage(command: string): string {
  return `${command} moves later reads to a directory outside the working directories, which the read block does not allow without asking (permissions.blockReadsOutsideWorkingDirectories). Add the directory with /add-dir, or remove that setting.`
}

/** official Tfo — latch so the first-ask dialog does not repeat. */
export function markSeenAutoModeOutsideReadPrompt(): void {
  saveGlobalConfig(current =>
    current.hasSeenAutoModeOutsideReadPrompt
      ? current
      : { ...current, hasSeenAutoModeOutsideReadPrompt: true },
  )
}

export function hasSeenAutoModeOutsideReadPrompt(): boolean {
  return getGlobalConfig().hasSeenAutoModeOutsideReadPrompt === true
}

/**
 * official `class Te` — session latch so only one outside-read first-ask
 * is open; a second Read/Grep in the same turn does not stamp.
 */
export class OutsideReadPrompt {
  openToolUseId: string | undefined
  answeredThisSession = false
  get answered(): boolean {
    return this.answeredThisSession
  }
  markAnswered(): void {
    this.answeredThisSession = true
  }
  isOpenElsewhere(toolUseId: string | undefined): boolean {
    return this.openToolUseId !== undefined && this.openToolUseId !== toolUseId
  }
  open(toolUseId: string | undefined): void {
    this.openToolUseId = toolUseId
  }
  closeFor(toolUseId: string | undefined): void {
    if (toolUseId !== undefined && this.openToolUseId === toolUseId) {
      this.openToolUseId = undefined
    }
  }
}

const sessionOutsideReadPrompt = new OutsideReadPrompt()

export function getOutsideReadPrompt(): OutsideReadPrompt {
  return sessionOutsideReadPrompt
}

export function resetOutsideReadPromptForTests(): void {
  sessionOutsideReadPrompt.openToolUseId = undefined
  sessionOutsideReadPrompt.answeredThisSession = false
}

/**
 * official Rfo — session fence + userSettings persist + sandbox refresh.
 */
export function persistBlockReadsOutsideWorkingDirectories(opts?: {
  setSessionToolPermissionContext?: (
    update: (prev: ToolPermissionContext) => ToolPermissionContext,
  ) => void
}): {
  error: Error | null
  sandboxRefreshed: boolean
} {
  opts?.setSessionToolPermissionContext?.(prev => ({
    ...prev,
    blockReadsOutsideWorkingDirectories: true,
  }))
  if (!isSettingSourceEnabled('userSettings')) {
    return {
      error: new Error(
        'user settings are not a setting source of this session',
      ),
      sandboxRefreshed: false,
    }
  }
  try {
    updateSettingsForSource('userSettings', {
      permissions: { blockReadsOutsideWorkingDirectories: true },
    })
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    return { error, sandboxRefreshed: false }
  }
  try {
    SandboxManager.refreshConfig()
    return { error: null, sandboxRefreshed: true }
  } catch {
    return { error: null, sandboxRefreshed: false }
  }
}

export type OutsideReadFirstPromptContext = {
  mode: string
  shouldAvoidPermissionPrompts?: boolean
  blockReadsOutsideWorkingDirectories?: boolean
  /**
   * densable `g.servedCall` — CCR/remote served permission context.
   * yBt: `if(s.forRemoteExecution===!0||g.servedCall===!0)return!1`
   */
  servedCall?: boolean
}

/**
 * densable xa @ 177386583 — `e==="auto"||e==="plan"&&!s&&Jf()`.
 * yBt calls `xa(g.mode)` so the second arg stays false (plan counts only
 * while auto-mode is active). lL/`getAllowRules` passes `servedCall===true`
 * so a served plan+auto context does **not** take the auto allow-filter path.
 * Not ctn/`isPermissionContextAutoMode` (that one also checks bypass inherit).
 */
export function isAutoModeOrPlanActingAsAuto(
  mode: string,
  servedCall = false,
): boolean {
  if (mode === 'auto') return true
  return mode === 'plan' && servedCall !== true && isAutoModeActive()
}

/**
 * official yBt — first auto-mode outside-read ask (Yes/Block/ask_again).
 * Host/session latch fields live on the caller; this is the permission-layer gate.
 */
export function shouldOfferBlockOutsideReads(opts: {
  toolName: string
  hasPath: boolean
  behavior: string
  decisionReasonType?: string
  context: OutsideReadFirstPromptContext
  isNonInteractiveSession?: boolean
  toolUseId?: string
  /** densable `s.forRemoteExecution` — remote-agent permission check. */
  forRemoteExecution?: boolean
}): boolean {
  if (opts.behavior !== 'ask' || opts.decisionReasonType !== 'workingDir') {
    return false
  }
  if (!isOutsideReadFileToolName(opts.toolName) || !opts.hasPath) {
    return false
  }
  const { context } = opts
  // gold yBt: if(!xa(g.mode)||…) — plan + Jf() (auto-mode active) stamps DualInk
  if (!isAutoModeOrPlanActingAsAuto(context.mode)) return false
  if (context.shouldAvoidPermissionPrompts) return false
  if (context.blockReadsOutsideWorkingDirectories === true) return false
  // gold yBt: if(s.forRemoteExecution===!0||g.servedCall===!0)return!1
  // DualInk first-ask is local TTY only — remote/CCR has its own relay.
  if (opts.forRemoteExecution === true || context.servedCall === true) {
    return false
  }
  if (opts.isNonInteractiveSession) return false
  // gold yBt: if(Et()||QCe()) return false. Et = session kind bg; QCe = swarm worker.
  if (isBgSession() || isTeammate()) return false
  if (!isSettingSourceEnabled('userSettings')) return false
  const prompt = getOutsideReadPrompt()
  // gold yBt: !isOpenElsewhere(toolUseId) && !answered && !hasSeen
  if (prompt.isOpenElsewhere(opts.toolUseId)) return false
  if (prompt.answered) return false
  if (hasSeenAutoModeOutsideReadPrompt()) return false
  return true
}
