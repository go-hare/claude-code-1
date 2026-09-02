/**
 * densable tyy / EMs.
 *
 * Gold 2.1.239: jsu `vM($no,tyy)`. Esc/onCancel → `{behavior:"deny"}`.
 * lUA mints via S3 (J0s + Ubn + Z0s). EMs yes-prefix-edited is Xxs(seed,
 * edited, PowerShell). Qgy async seed suffix is ` *`. Host answer is
 * store.answer; do not dequeue.
 */
import { shouldUseSandbox } from '@claude-code/builtin-tools/tools/BashTool/shouldUseSandbox.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import type { PermissionUpdate } from '../types/permissions.js'
import { SandboxManager } from '../utils/sandbox/sandbox-adapter.js'
import { isClassifierNotApprovable } from './classifierVeto.js'
import {
  ConsentRow,
  isShellConsentLabelRule,
  mintConsentRow,
  mintPrefixConsentRow,
  renderShellSuggestionsLabel,
  sanitizeEditablePrefix,
  SHELL_DISPLAYED_TYPES,
  type ShellPermissionAnswerExtras,
} from './consentRow.js'
import {
  APPROVAL_WITHHELD_MARKER,
  previewUrlString,
  type UrlPreview,
} from './permissionBrowser.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'
import type { PermissionPromptResult } from './specs/permissionKinds.js'

export type PowerShellPermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  command: string
  input?: unknown
  description?: string
  showAlwaysAllow?: boolean
  isAskCappedByOrg?: boolean
  requestSource?: PermissionRequestSource
  isMcp?: boolean
}

export type PowerShellSuggestionsRow = ConsentRow

/** densable Xgy placeholder */
export const POWERSHELL_PREFIX_PLACEHOLDER =
  'command prefix (e.g., Get-Process *)'

export type PowerShellPermissionChoice =
  | 'yes'
  | 'yes-apply-suggestions'
  | 'yes-prefix-edited'
  | 'no'

function isValidAllowRow(
  row: PowerShellSuggestionsRow | null,
): row is PowerShellSuggestionsRow {
  return ConsentRow.is(row) && row.applies.length > 0
}

function inputRecord(payload: PowerShellPermissionPayload): {
  command?: unknown
  dangerouslyDisableSandbox?: unknown
} {
  return (
    (payload.input as
      | { command?: unknown; dangerouslyDisableSandbox?: unknown }
      | undefined) ?? {}
  )
}

function commandString(payload: PowerShellPermissionPayload): string {
  const command = inputRecord(payload).command
  return typeof command === 'string' ? command : payload.command
}

/** densable tyy withheld: yO withheld OR command not string. */
export function isPowerShellCommandWithheld(
  payload: PowerShellPermissionPayload,
): boolean {
  const command = inputRecord(payload).command
  if (typeof command !== 'string') return true
  const preview = previewUrlString(command)
  return preview === null || preview.kind === 'withheld'
}

/** densable tyy veto `O`: w2 + org cap + remote-agent. */
export function isPowerShellAlwaysAllowVetoed(
  payload: PowerShellPermissionPayload,
): boolean {
  return (
    isClassifierNotApprovable(payload.permissionResult) ||
    payload.isAskCappedByOrg === true ||
    payload.requestSource?.type === 'remote-agent'
  )
}

/** Raw suggestions bag for Qgy/prefix DualInk analog. */
export function powerShellPayloadSuggestions(
  payload: PowerShellPermissionPayload,
): PermissionUpdate[] {
  const suggestions = (
    payload.permissionResult as { suggestions?: unknown } | null
  )?.suggestions
  if (!Array.isArray(suggestions) || suggestions.length === 0) return []
  return suggestions as PermissionUpdate[]
}

/** densable lUA — S3(suggestions, J0s, Ubn(PowerShell), Z0s). */
export function buildPowerShellSuggestionsRow(
  payload: PowerShellPermissionPayload,
): PowerShellSuggestionsRow | null {
  if (!shouldShowPowerShellSuggestions(payload)) return null
  const suggestions = (
    payload.permissionResult as { suggestions?: unknown } | null
  )?.suggestions
  return mintConsentRow(suggestions, {
    displayedTypes: SHELL_DISPLAYED_TYPES,
    labelPredicate: rule => isShellConsentLabelRule(rule, POWERSHELL_TOOL_NAME),
    renderLabel: updates =>
      renderShellSuggestionsLabel(updates, POWERSHELL_TOOL_NAME),
  })
}

export function shouldShowPowerShellSuggestions(
  payload: PowerShellPermissionPayload,
): boolean {
  return (
    !isPowerShellCommandWithheld(payload) &&
    !isPowerShellAlwaysAllowVetoed(payload)
  )
}

/** DualInk shouldShowPersistentAllowOption analog via iK showAlwaysAllow. */
export function shouldShowPowerShellPersistentAllow(
  payload: PowerShellPermissionPayload,
): boolean {
  return (
    payload.showAlwaysAllow === true &&
    buildPowerShellSuggestionsRow(payload) !== null
  )
}

/** DualInk analog: prefix input cannot represent addDirectories / non-PS rules. */
export function powerShellSuggestionsHaveNonShell(
  suggestions: readonly PermissionUpdate[],
): boolean {
  return suggestions.some(
    s =>
      s.type === 'addDirectories' ||
      (s.type === 'addRules' &&
        s.rules?.some(r => r.toolName !== POWERSHELL_TOOL_NAME)),
  )
}

/**
 * densable tyy useState: withheld/multiline → undefined; else YAe(command).
 * Qgy then may replace with YAe(`${prefix} *`).
 */
export function seedPowerShellEditablePrefix(
  payload: PowerShellPermissionPayload,
): string | undefined {
  if (isPowerShellCommandWithheld(payload)) return undefined
  const command = commandString(payload)
  if (typeof command !== 'string' || command.length === 0) return undefined
  if (command.includes('\n')) return undefined
  return sanitizeEditablePrefix(command)
}

/** densable Xxs(seed, edited, PowerShell). */
export function powerShellPrefixUpdates(
  seed: unknown,
  edited: unknown,
): PermissionUpdate[] {
  return [
    ...(mintPrefixConsentRow(seed, edited, POWERSHELL_TOOL_NAME)?.applies ??
      []),
  ]
}

/** densable tyy EX({command, dangerouslyDisableSandbox, shellType:"powershell"}). */
export function isPowerShellSandboxed(
  payload: PowerShellPermissionPayload,
): boolean {
  if (!SandboxManager.isSandboxingEnabled()) return false
  if (payload.requestSource?.type === 'remote-agent') return false
  const input = inputRecord(payload)
  const command =
    typeof input.command === 'string' ? input.command : payload.command
  return shouldUseSandbox({
    command,
    dangerouslyDisableSandbox: input.dangerouslyDisableSandbox === true,
    shellType: 'powershell',
  })
}

/** densable tyy title: C&&!x ? unsandboxed : "PowerShell command". */
export function powerShellCommandTitle(
  payload: PowerShellPermissionPayload,
): string {
  const enabled = SandboxManager.isSandboxingEnabled()
  return enabled && !isPowerShellSandboxed(payload)
    ? 'PowerShell command (unsandboxed)'
    : 'PowerShell command'
}

export function powerShellCommandPreview(
  payload: PowerShellPermissionPayload,
): UrlPreview {
  const preview = previewUrlString(inputRecord(payload).command)
  if (preview === null) {
    return { kind: 'withheld', marker: APPROVAL_WITHHELD_MARKER }
  }
  return preview
}

/**
 * densable EMs. yes-prefix-edited: Xxs(seed, edited, PowerShell);
 * null → allow no updates.
 */
export function resolvePowerShellPermissionAnswer(
  choice: PowerShellPermissionChoice,
  payload: PowerShellPermissionPayload,
  row: PowerShellSuggestionsRow | null,
  extras: ShellPermissionAnswerExtras = {},
): PermissionPromptResult {
  const feedback = extras.feedback
  switch (choice) {
    case 'yes':
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        ...(feedback ? { feedback } : {}),
      }
    case 'yes-prefix-edited': {
      const minted = mintPrefixConsentRow(
        extras.editablePrefixSeed,
        extras.editablePrefix,
        POWERSHELL_TOOL_NAME,
      )
      if (minted === null) {
        return { behavior: 'allow', updatedInput: payload.input }
      }
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        permissionUpdates: [...minted.applies],
      }
    }
    case 'yes-apply-suggestions':
      if (!isValidAllowRow(row)) {
        return { behavior: 'allow', updatedInput: payload.input }
      }
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        permissionUpdates: [...row.applies],
      }
    case 'no':
      return {
        behavior: 'deny',
        ...(feedback ? { feedback } : {}),
      }
  }
}
