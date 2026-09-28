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

export function blockedOutsideReadCwdMoveMessage(command: string): string {
  return `${command} moves later reads to a directory outside the working directories, which the read block does not allow without asking (permissions.blockReadsOutsideWorkingDirectories). Add the directory with /add-dir, or remove that setting.`
}

/** official Rfo persist to userSettings */
export function persistBlockReadsOutsideWorkingDirectories(): {
  error: Error | null
} {
  if (!isSettingSourceEnabled('userSettings')) {
    return {
      error: new Error(
        'user settings are not a setting source of this session',
      ),
    }
  }
  try {
    updateSettingsForSource('userSettings', {
      permissions: { blockReadsOutsideWorkingDirectories: true },
    })
    return { error: null }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    return { error }
  }
}

export type OutsideReadFirstPromptContext = {
  mode: string
  shouldAvoidPermissionPrompts?: boolean
  blockReadsOutsideWorkingDirectories?: boolean
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
}): boolean {
  if (opts.behavior !== 'ask' || opts.decisionReasonType !== 'workingDir') {
    return false
  }
  if (!isOutsideReadFileToolName(opts.toolName) || !opts.hasPath) {
    return false
  }
  const { context } = opts
  if (context.mode !== 'auto') return false
  if (context.shouldAvoidPermissionPrompts) return false
  if (context.blockReadsOutsideWorkingDirectories === true) return false
  if (opts.isNonInteractiveSession) return false
  if (!isSettingSourceEnabled('userSettings')) return false
  return true
}
