/**
 * densable Mhy / Y$A / yhy / E$A / X$A / J$A.
 *
 * Gold 2.1.239: jsu `vM(S4t,Mhy)`. Esc/onCancel → reject → deny.
 * E$A mints standing row (S3 + PYe + Yxs + w$A). Y$A uses minted
 * applies. standingRowVetoed omits accept-session. Host answer only.
 */
import {
  CLAUDE_FOLDER_PERMISSION_PATTERN,
  FILE_EDIT_TOOL_NAME,
  GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN,
} from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { createElement, type ReactNode } from 'react'
import { Text } from '@anthropic/ink'
import type { ToolPermissionContext } from '../Tool.js'
import { generateSuggestions } from '../utils/permissions/filesystem.js'
import {
  isInClaudeFolder,
  isInGlobalClaudeFolder,
} from '../components/permissions/FilePermissionDialog/permissionOptions.js'
import {
  ConsentRow,
  combineConsentRows,
  FILE_FAMILY_NO_SHELL_TOOL,
  FILE_STANDING_DISPLAYED_TYPES,
  isShellConsentLabelRule,
  mintAddDirectoriesRow,
  mintConsentRow,
  mintSetModeRow,
  renderFileReadStandingLabel,
} from './consentRow.js'
import type {
  FilePermissionContent,
  FilePermissionQuestion,
} from './filePermissionPreview.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'
import type { PermissionPromptResult } from './specs/permissionKinds.js'

export const CLAUDE_FOLDER_STANDING_LABEL =
  'Yes, and allow Claude to edit its own settings for this session'

export type FilePermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  input?: unknown
  title: string
  subtitle?: string
  question: FilePermissionQuestion
  content: FilePermissionContent
  contentWithheld: boolean
  filePath: string
  operationType: 'read' | 'write'
  symlinkTarget: string | null
  showAlwaysAllow?: boolean
  isAskCappedByOrg?: boolean
  requestSource?: PermissionRequestSource
  isMcp?: boolean
  /** densable Mhy `e.showingDiffInIDE` — doo stampIdeDiffFields. */
  showingDiffInIDE?: boolean
  /** densable Mhy `e.ideName` — doo stampIdeDiffFields. */
  ideName?: string
  /** DualInk analog FilesystemPermissionRequest / iK userFacingName. */
  userFacingName?: string
  /** DualInk analog FilesystemPermissionRequest / iK renderToolUseMessage. */
  renderedToolUseMessage?: string | unknown
  hasMcpSuffix?: boolean
}

export type FilePermissionChoice =
  | 'yes'
  | 'yes-session'
  | 'yes-claude-folder'
  | 'no'

/** densable Mhy `_` standingRowVetoed. */
export function isFileStandingRowVetoed(
  payload: FilePermissionPayload,
): boolean {
  const result = payload.permissionResult as {
    behavior?: string
    decisionReason?: { type?: string; classifierApprovable?: boolean }
  } | null
  const reason = result?.behavior === 'ask' ? result.decisionReason : undefined
  return (
    (reason?.type === 'safetyCheck' && reason.classifierApprovable === false) ||
    payload.isAskCappedByOrg === true ||
    payload.requestSource?.type === 'remote-agent' ||
    payload.contentWithheld === true
  )
}

/** densable Mhy title: `Opened changes in ${J$e(ideName??"IDE")} ⧉`. */
export function filePermissionDialogTitle(
  payload: FilePermissionPayload,
): string {
  if (payload.showingDiffInIDE) {
    return `Opened changes in ${payload.ideName ?? 'IDE'} ⧉`
  }
  return payload.title
}

/** densable X$A string analog (tests). */
export function formatFilePermissionQuestion(
  question: FilePermissionQuestion,
): string {
  if (question.kind === 'file-action') {
    return `Do you want to ${question.verbPhrase} ${question.fileName}?`
  }
  return question.text
}

/** densable X$A */
export function filePermissionQuestionNode(
  question: FilePermissionQuestion,
): ReactNode {
  if (question.kind === 'plain') {
    return createElement(Text, null, question.text)
  }
  return createElement(
    Text,
    null,
    'Do you want to ',
    question.verbPhrase,
    ' ',
    createElement(Text, { bold: true }, question.fileName),
    '?',
  )
}

export type FileStandingMint = {
  row: ConsentRow
  value: 'yes-session' | 'yes-claude-folder'
}

/** densable E$A */
export function mintFileStandingRow(
  filePath: string,
  operationType: 'read' | 'write',
  toolPermissionContext: ToolPermissionContext | undefined,
): FileStandingMint | null {
  const inClaude = isInClaudeFolder(filePath)
  const inGlobal = isInGlobalClaudeFolder(filePath)
  if ((inClaude || inGlobal) && operationType !== 'read') {
    const pattern = inGlobal
      ? GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN
      : CLAUDE_FOLDER_PERMISSION_PATTERN
    const row = mintConsentRow(
      [
        {
          type: 'addRules',
          rules: [{ toolName: FILE_EDIT_TOOL_NAME, ruleContent: pattern }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
      {
        displayedTypes: FILE_STANDING_DISPLAYED_TYPES,
        renderLabel: updates => {
          const update = updates.length === 1 ? updates[0] : undefined
          if (
            update === undefined ||
            update.type !== 'addRules' ||
            update.rules.length !== 1 ||
            update.rules[0]?.toolName !== FILE_EDIT_TOOL_NAME ||
            update.rules[0]?.ruleContent !== pattern
          ) {
            return null
          }
          return CLAUDE_FOLDER_STANDING_LABEL
        },
      },
    )
    return row === null ? null : { row, value: 'yes-claude-folder' }
  }
  if (!toolPermissionContext || filePath === '') return null
  const suggestions = generateSuggestions(
    filePath,
    operationType,
    toolPermissionContext,
  )
  const parts: ConsentRow[] = []
  const setMode = suggestions.find(item => item.type === 'setMode')
  if (setMode?.type === 'setMode' && setMode.mode === 'acceptEdits') {
    const row = mintSetModeRow('acceptEdits')
    if (row !== null) parts.push(row)
  }
  const addDirs = suggestions.find(item => item.type === 'addDirectories')
  if (addDirs?.type === 'addDirectories') {
    const row = mintAddDirectoriesRow(addDirs.directories)
    if (row !== null) parts.push(row)
  }
  const addRules = suggestions.filter(item => item.type === 'addRules')
  if (addRules.length > 0) {
    const row = mintConsentRow(addRules, {
      displayedTypes: FILE_STANDING_DISPLAYED_TYPES,
      labelPredicate: rule =>
        isShellConsentLabelRule(rule, FILE_FAMILY_NO_SHELL_TOOL),
      renderLabel: renderFileReadStandingLabel,
    })
    if (row !== null) parts.push(row)
  }
  const [first, ...rest] = parts
  if (first === undefined) return null
  return {
    row: rest.length === 0 ? first : combineConsentRows(first, ...rest),
    value: 'yes-session',
  }
}

/**
 * densable Y$A. accept-session uses E$A minted applies; missing row
 * degrades to allow without updates.
 */
export function resolveFilePermissionAnswer(
  choice: FilePermissionChoice,
  payload: FilePermissionPayload,
  standing: FileStandingMint | null,
  feedback?: string,
): PermissionPromptResult {
  switch (choice) {
    case 'yes':
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        ...(feedback ? { feedback } : {}),
      }
    case 'yes-claude-folder':
    case 'yes-session': {
      if (standing === null || !ConsentRow.is(standing.row)) {
        return {
          behavior: 'allow',
          updatedInput: payload.input,
          ...(feedback ? { feedback } : {}),
        }
      }
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        permissionUpdates: [...standing.row.applies],
        ...(feedback ? { feedback } : {}),
      }
    }
    case 'no':
      return {
        behavior: 'deny',
        ...(feedback ? { feedback } : {}),
      }
  }
}
