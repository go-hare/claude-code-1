/**
 * densable Iiu / Vgy / sLo / Riu / qgy.
 *
 * Gold 2.1.239: jsu `vM(bEt,Iiu)`. Esc/onCancel → `{behavior:"cancelled"}`.
 * fiu table + CFn/ctrl+o live in permissionMcpTable. m0n: workflow-agent
 * + FKe → DPo("workflow") / xge. sLo: showAlwaysAllow && !Riu && $bn.
 */
import { renderDontAskAgainLabel } from '../components/permissions/dontAskAgainLabel.js'
import { isClassifierNotApprovable } from './classifierVeto.js'
import {
  ConsentRow,
  isMintableBareToolName,
  mintConsentRow,
} from './consentRow.js'
import type { ParamFormatHints } from './permissionMcpTable.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'
import type { PermissionPromptResult } from './specs/permissionKinds.js'

/** densable tUA */
const PROMPT_DAA_TYPES = new Set(['addRules'])

export type PromptPermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  input?: unknown
  description?: string
  userFacingName?: string
  hasMcpSuffix?: boolean
  isMcp?: boolean
  renderedToolUseMessage?: string | unknown
  toolUseRenderFailed?: boolean
  paramFormatHints?: ParamFormatHints
  showAlwaysAllow?: boolean
  isAskCappedByOrg?: boolean
  requestSource?: PermissionRequestSource
}

export type PromptDontAskAgainRow = ConsentRow

export type PromptPermissionChoice =
  | 'yes'
  | 'yes-dont-ask-again'
  | 'yes-enable-auto-mode'
  | 'no'

function isValidAllowRow(
  row: PromptDontAskAgainRow | null,
): row is PromptDontAskAgainRow {
  return ConsentRow.is(row) && row.applies.length > 0
}

/** densable Riu */
export function isPromptAlwaysAllowVetoed(
  payload: PromptPermissionPayload,
): boolean {
  return (
    isClassifierNotApprovable(payload.permissionResult) ||
    payload.isAskCappedByOrg === true ||
    payload.requestSource?.type === 'remote-agent'
  )
}

/**
 * densable sLo: showAlwaysAllow && !Riu && $bn(toolName).
 */
export function shouldShowPromptAlwaysAllow(
  payload: PromptPermissionPayload,
): boolean {
  return (
    payload.showAlwaysAllow === true &&
    !isPromptAlwaysAllowVetoed(payload) &&
    isMintableBareToolName(payload.toolName)
  )
}

export type PromptDontAskAgainLabelArgs = {
  cwd: string
  maxLabelWidth: number
}

/** densable qgy — S3(addRules toolName, tUA, MYg renderLabel). */
export function buildPromptDontAskAgainRow(
  payload: PromptPermissionPayload,
  label: PromptDontAskAgainLabelArgs,
): PromptDontAskAgainRow | null {
  return mintConsentRow(
    [
      {
        type: 'addRules',
        rules: [{ toolName: payload.toolName }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ],
    {
      displayedTypes: PROMPT_DAA_TYPES,
      renderLabel: updates => {
        const update = updates.length === 1 ? updates[0] : undefined
        if (
          update === undefined ||
          update.type !== 'addRules' ||
          update.rules.length !== 1 ||
          update.rules[0]?.toolName !== payload.toolName ||
          update.rules[0]?.ruleContent !== undefined
        ) {
          return null
        }
        return renderDontAskAgainLabel({
          toolName: String(payload.userFacingName),
          cwd: label.cwd,
          maxLabelWidth: label.maxLabelWidth,
        })
      },
    },
  )
}

/** densable Iiu description: split('.').filter(nUA).join.trim — nUA = nonempty. */
export function formatPromptDescription(description: unknown): string {
  const raw = typeof description === 'string' ? description : ''
  return raw
    .split('.')
    .filter(part => part.trim() !== '')
    .join('.')
    .trim()
}

/** densable Vgy — auto-mode choice still allow+input; xge is a Host side effect. */
export function resolvePromptPermissionAnswer(
  choice: PromptPermissionChoice,
  payload: PromptPermissionPayload,
  row: PromptDontAskAgainRow | null,
  feedback?: string,
): PermissionPromptResult {
  switch (choice) {
    case 'yes':
    case 'yes-enable-auto-mode':
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        ...(feedback ? { feedback } : {}),
      }
    case 'yes-dont-ask-again':
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
