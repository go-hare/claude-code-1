/**
 * densable Cmy / $Oo.
 *
 * Gold 2.1.239: jsu `vM(Byr,Cmy)`. Esc/onCancel → `{behavior:"deny"}`.
 * jNA mints via S3 (J0s + Ubn + Z0s). $Oo yes-prefix-edited is Xxs(seed,
 * edited, Bash). YAe seed suffix is ` *` (not DualInk `:*`). m0n:
 * workflow-agent + FKe → auto-mode option. Host answer is store.answer;
 * do not dequeue.
 */
import {
  getFirstWordPrefix,
  getSimpleCommandPrefix,
} from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { shouldUseSandbox } from '@claude-code/builtin-tools/tools/BashTool/shouldUseSandbox.js'
import { extractOutputRedirections } from '../utils/bash/commands.js'
import { extractRules } from '../utils/permissions/PermissionUpdate.js'
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

export type BashPermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  command: string
  input?: unknown
  description?: string
  classifierState?: string
  showAlwaysAllow?: boolean
  isAskCappedByOrg?: boolean
  requestSource?: PermissionRequestSource
  isMcp?: boolean
}

export type BashSuggestionsRow = ConsentRow

/** densable tmy placeholder */
export const BASH_PREFIX_PLACEHOLDER = 'command prefix (e.g., npm run *)'

export type BashPermissionChoice =
  | 'yes'
  | 'yes-apply-suggestions'
  | 'yes-prefix-edited'
  | 'yes-enable-auto-mode'
  | 'no'

export type { ShellPermissionAnswerExtras }

function isValidAllowRow(
  row: BashSuggestionsRow | null,
): row is BashSuggestionsRow {
  return ConsentRow.is(row) && row.applies.length > 0
}

function inputCommand(payload: BashPermissionPayload): unknown {
  return (payload.input as { command?: unknown } | undefined)?.command
}

/** densable Cmy withheld: yO withheld OR command not string. */
export function isBashCommandWithheld(payload: BashPermissionPayload): boolean {
  const command = inputCommand(payload)
  if (typeof command !== 'string') return true
  const preview = previewUrlString(command)
  return preview === null || preview.kind === 'withheld'
}

/**
 * densable Cmy veto `a`: w2(decisionReason, !classifierApprovable)
 * OR org cap OR requestSource remote-agent.
 */
export function isBashAlwaysAllowVetoed(
  payload: BashPermissionPayload,
): boolean {
  return (
    isClassifierNotApprovable(payload.permissionResult) ||
    payload.isAskCappedByOrg === true ||
    payload.requestSource?.type === 'remote-agent'
  )
}

/** Raw suggestions bag for YAe/prefix DualInk analog. */
export function bashPayloadSuggestions(
  payload: BashPermissionPayload,
): PermissionUpdate[] {
  const suggestions = (
    payload.permissionResult as { suggestions?: unknown } | null
  )?.suggestions
  if (!Array.isArray(suggestions) || suggestions.length === 0) return []
  return suggestions as PermissionUpdate[]
}

/** densable jNA — S3(suggestions, J0s, Ubn(Bash, unu), Z0s). */
export function buildBashSuggestionsRow(
  payload: BashPermissionPayload,
): BashSuggestionsRow | null {
  if (!shouldShowBashSuggestions(payload)) return null
  const suggestions = (
    payload.permissionResult as { suggestions?: unknown } | null
  )?.suggestions
  return mintConsentRow(suggestions, {
    displayedTypes: SHELL_DISPLAYED_TYPES,
    labelPredicate: rule =>
      isShellConsentLabelRule(rule, BASH_TOOL_NAME, stripBashRedirections),
    renderLabel: updates =>
      renderShellSuggestionsLabel(
        updates,
        BASH_TOOL_NAME,
        stripBashRedirections,
      ),
  })
}

export function shouldShowBashSuggestions(
  payload: BashPermissionPayload,
): boolean {
  return !isBashCommandWithheld(payload) && !isBashAlwaysAllowVetoed(payload)
}

/** DualInk shouldShowPersistentAllowOption analog via iK showAlwaysAllow. */
export function shouldShowBashPersistentAllow(
  payload: BashPermissionPayload,
): boolean {
  return (
    payload.showAlwaysAllow === true &&
    buildBashSuggestionsRow(payload) !== null
  )
}

/** DualInk analog: prefix input cannot represent addDirectories / non-Bash rules. */
export function bashSuggestionsHaveNonBash(
  suggestions: readonly PermissionUpdate[],
): boolean {
  return suggestions.some(
    s =>
      s.type === 'addDirectories' ||
      (s.type === 'addRules' &&
        s.rules?.some(r => r.toolName !== BASH_TOOL_NAME)),
  )
}

/**
 * densable Cmy useState seed. Withheld → undefined. Compound: single
 * backend Bash rule → YAe(ruleContent); many → undefined. Else BDi/szf
 * `YAe(\`${prefix} *\`)` or YAe(command).
 */
export function seedBashEditablePrefix(
  payload: BashPermissionPayload,
): string | undefined {
  if (isBashCommandWithheld(payload)) return undefined
  const command =
    typeof inputCommand(payload) === 'string'
      ? (inputCommand(payload) as string)
      : payload.command
  if (typeof command !== 'string' || command.length === 0) return undefined
  const isCompound =
    (
      payload.permissionResult as {
        decisionReason?: { type?: string }
      } | null
    )?.decisionReason?.type === 'subcommandResults'
  if (isCompound) {
    const minted = buildBashSuggestionsRow(payload)
    const backendBashRules = extractRules([...(minted?.applies ?? [])]).filter(
      r => r.toolName === BASH_TOOL_NAME && r.ruleContent,
    )
    if (backendBashRules.length === 1) {
      return sanitizeEditablePrefix(backendBashRules[0]!.ruleContent)
    }
    if (backendBashRules.length > 1) return undefined
  }
  const two = getSimpleCommandPrefix(command)
  if (two) return sanitizeEditablePrefix(`${two} *`)
  const one = getFirstWordPrefix(command)
  if (one) return sanitizeEditablePrefix(`${one} *`)
  return sanitizeEditablePrefix(command)
}

/** DualInk analog: strip redirections so filenames don't show as commands. */
export function stripBashRedirections(command: string): string {
  const { commandWithoutRedirections, redirections } =
    extractOutputRedirections(command)
  return redirections.length > 0 ? commandWithoutRedirections : command
}

/** densable Xxs(seed, edited, Bash). */
export function bashPrefixUpdates(
  seed: unknown,
  edited: unknown,
): PermissionUpdate[] {
  return [
    ...(mintPrefixConsentRow(seed, edited, BASH_TOOL_NAME)?.applies ?? []),
  ]
}

/** densable Cmy `EX(e.input)` DualInk analog. */
export function isBashSandboxed(payload: BashPermissionPayload): boolean {
  if (!SandboxManager.isSandboxingEnabled()) return false
  if (payload.requestSource?.type === 'remote-agent') return false
  if (typeof inputCommand(payload) !== 'string') return false
  return shouldUseSandbox(
    payload.input as {
      command?: string
      dangerouslyDisableSandbox?: boolean
    },
  )
}

/** densable Cmy title: D&&!F ? unsandboxed : "Bash command". */
export function bashCommandTitle(payload: BashPermissionPayload): string {
  const enabled = SandboxManager.isSandboxingEnabled()
  return enabled && !isBashSandboxed(payload)
    ? 'Bash command (unsandboxed)'
    : 'Bash command'
}

export function bashCommandPreview(payload: BashPermissionPayload): UrlPreview {
  const preview = previewUrlString(inputCommand(payload))
  if (preview === null) {
    return { kind: 'withheld', marker: APPROVAL_WITHHELD_MARKER }
  }
  return preview
}

/**
 * densable $Oo. yes-enable-auto-mode still allow+input; xge is Host.
 * yes-prefix-edited: Xxs(seed, edited, Bash); null → allow no updates.
 */
export function resolveBashPermissionAnswer(
  choice: BashPermissionChoice,
  payload: BashPermissionPayload,
  row: BashSuggestionsRow | null,
  extras: ShellPermissionAnswerExtras = {},
): PermissionPromptResult {
  const feedback = extras.feedback
  switch (choice) {
    case 'yes':
    case 'yes-enable-auto-mode':
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        ...(feedback ? { feedback } : {}),
      }
    case 'yes-prefix-edited': {
      const minted = mintPrefixConsentRow(
        extras.editablePrefixSeed,
        extras.editablePrefix,
        BASH_TOOL_NAME,
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
