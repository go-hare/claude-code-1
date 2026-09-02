/**
 * densable Wou / _gy / vgy / Sgy / bgy.
 *
 * Gold 2.1.239: jsu `vM(Nno,Wou)`. Esc/onCancel → `{behavior:"deny"}`.
 * bgy mints via S3 + EFA / Yxs — no invented labels. Host answer only.
 */
import { isAskGatedClassifierNotApprovable } from './classifierVeto.js'
import {
  combineConsentRows,
  ConsentRow,
  mintAddDirectoriesRow,
  mintConsentRow,
  MONITOR_DISPLAYED_TYPES,
  renderMonitorSuggestionsLabel,
  CONSENT_INTAKE_CAP,
  CONSENT_ITEM_CAP,
} from './consentRow.js'
import type { PermissionRequestSource } from './permissionRequestSource.js'
import type { UrlPreview } from './permissionBrowser.js'
import type { PermissionPromptResult } from './specs/permissionKinds.js'

export type MonitorMcpPayload = {
  server: string
  tool: string
  argsDisplay?: UrlPreview
}

export type MonitorWsPayload = {
  url: UrlPreview
  protocols?: string[]
}

export type MonitorPermissionPayload = {
  requestId: string
  toolName: string
  permissionResult: unknown
  intervalMs: number
  input?: unknown
  command?: UrlPreview
  mcp?: MonitorMcpPayload
  ws?: MonitorWsPayload
  monitorDescription?: string
  showAlwaysAllow?: boolean
  isAskCappedByOrg?: boolean
  requestSource?: PermissionRequestSource
}

export type MonitorSuggestionsRow = ConsentRow

export type MonitorPermissionChoice = 'yes' | 'yes-apply-suggestions' | 'no'

function isValidAllowRow(row: MonitorSuggestionsRow | null): boolean {
  return ConsentRow.is(row)
}

/** densable vgy — ask-gated w2 classifier veto OR org cap. */
export function isMonitorAlwaysAllowVetoed(
  payload: MonitorPermissionPayload,
): boolean {
  return (
    isAskGatedClassifierNotApprovable(payload.permissionResult) ||
    payload.isAskCappedByOrg === true
  )
}

/** densable Sgy */
export function isMonitorPreviewWithheld(
  payload: MonitorPermissionPayload,
): boolean {
  return (
    payload.command?.kind === 'withheld' ||
    payload.mcp?.argsDisplay?.kind === 'withheld' ||
    payload.ws?.url.kind === 'withheld' ||
    (payload.command === undefined &&
      payload.mcp === undefined &&
      payload.ws === undefined)
  )
}

/**
 * densable bgy — S3(addRules, EFA) plus Yxs(addDirectories), then Jxs.
 */
export function buildMonitorSuggestionsRow(
  payload: MonitorPermissionPayload,
): MonitorSuggestionsRow | null {
  const suggestions = (
    payload.permissionResult as { suggestions?: unknown } | null
  )?.suggestions
  if (!Array.isArray(suggestions) || suggestions.length === 0) return null
  const rows: ConsentRow[] = []
  const rulesRow = mintConsentRow(suggestions, {
    displayedTypes: MONITOR_DISPLAYED_TYPES,
    renderLabel: renderMonitorSuggestionsLabel,
  })
  if (rulesRow !== null) rows.push(rulesRow)
  const directories: unknown[] = []
  let honest = false
  try {
    const length = suggestions.length
    honest =
      typeof length === 'number' &&
      Number.isSafeInteger(length) &&
      length >= 0 &&
      length <= CONSENT_INTAKE_CAP
    if (honest) {
      let budget = CONSENT_INTAKE_CAP * CONSENT_ITEM_CAP
      for (let i = 0; i < length && honest; i++) {
        try {
          const item = suggestions[i]
          if (
            item === null ||
            typeof item !== 'object' ||
            (item as { type?: unknown }).type !== 'addDirectories'
          ) {
            continue
          }
          const list = (item as { directories?: unknown }).directories
          if (!Array.isArray(list)) continue
          const size = list.length
          if (
            typeof size !== 'number' ||
            !Number.isSafeInteger(size) ||
            size < 0
          ) {
            continue
          }
          budget -= size
          if (budget < 0) {
            honest = false
            break
          }
          for (let j = 0; j < size; j++) directories.push(list[j])
        } catch {
          // gold continues
        }
      }
    }
  } catch {
    honest = false
  }
  if (honest && directories.length > 0) {
    const dirRow = mintAddDirectoriesRow(directories)
    if (dirRow !== null) rows.push(dirRow)
  }
  const [first, ...rest] = rows
  if (first === undefined) return null
  return rest.length === 0 ? first : combineConsentRows(first, ...rest)
}

export function shouldShowMonitorSuggestions(
  payload: MonitorPermissionPayload,
): boolean {
  return (
    payload.showAlwaysAllow === true &&
    !isMonitorAlwaysAllowVetoed(payload) &&
    !isMonitorPreviewWithheld(payload)
  )
}

/** densable A0n */
export function monitorPreviewText(preview: UrlPreview): string {
  return preview.kind === 'full' ? preview.text : preview.marker
}

/** densable _gy */
export function resolveMonitorPermissionAnswer(
  choice: MonitorPermissionChoice,
  payload: MonitorPermissionPayload,
  row: MonitorSuggestionsRow | null,
  feedback?: string,
): PermissionPromptResult {
  switch (choice) {
    case 'yes':
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        ...(feedback ? { feedback } : {}),
      }
    case 'yes-apply-suggestions':
      if (!isValidAllowRow(row)) {
        return { behavior: 'allow', updatedInput: payload.input }
      }
      return {
        behavior: 'allow',
        updatedInput: payload.input,
        permissionUpdates: [...row!.applies],
      }
    case 'no':
      return {
        behavior: 'deny',
        ...(feedback ? { feedback } : {}),
      }
  }
}
