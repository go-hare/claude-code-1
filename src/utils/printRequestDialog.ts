/**
 * Official createPrintRequestDialog densable (cvf) + dialog kind registry.
 *
 * Full Query/SDK host dialog renderers remain denser; this densifies:
 * - kind registry (refusal_fallback_prompt, fable_overage_consent_prompt,
 *   mcp_url_elicitation)
 * - requestDialog dispatcher: elicitation → handleElicitation; user dialogs
 *   → requestUserDialog with cancel-on-queue + default on cancel/parse fail
 */

import { z } from 'zod/v4'

export const REFUSAL_FALLBACK_DIALOG_KIND = 'refusal_fallback_prompt' as const
export const FABLE_OVERAGE_CONSENT_DIALOG_KIND =
  'fable_overage_consent_prompt' as const
export const MCP_URL_ELICITATION_DIALOG_KIND = 'mcp_url_elicitation' as const

export type RefusalFallbackResult =
  | 'retry_fallback'
  | 'edit_prompt'
  | 'cancelled'

export type FableOverageConsentResult =
  | 'consent'
  | 'switch_default'
  | 'cancelled'

export type DialogKindSpec<TDefault = unknown> = {
  kind: string
  default: TDefault
  /** Optional result parser (official r.result().safeParse). */
  parseResult?: (
    value: unknown,
  ) => { success: true; data: TDefault } | { success: false }
}

export const refusalFallbackDialogSpec: DialogKindSpec<RefusalFallbackResult> =
  {
    kind: REFUSAL_FALLBACK_DIALOG_KIND,
    default: 'cancelled',
    parseResult: (value: unknown) => {
      if (
        value === 'retry_fallback' ||
        value === 'edit_prompt' ||
        value === 'cancelled'
      ) {
        return { success: true, data: value }
      }
      return { success: false }
    },
  }

export const fableOverageConsentDialogSpec: DialogKindSpec<FableOverageConsentResult> =
  {
    kind: FABLE_OVERAGE_CONSENT_DIALOG_KIND,
    default: 'cancelled',
    parseResult: (value: unknown) => {
      if (
        value === 'consent' ||
        value === 'switch_default' ||
        value === 'cancelled'
      ) {
        return { success: true, data: value }
      }
      return { success: false }
    },
  }

export const mcpUrlElicitationDialogSpec: DialogKindSpec<{
  action: 'cancel'
}> = {
  kind: MCP_URL_ELICITATION_DIALOG_KIND,
  default: { action: 'cancel' },
}

/** Official ZW/X6e user-dialog kinds that go through requestUserDialog. */
export const USER_DIALOG_KIND_SPECS: ReadonlyArray<DialogKindSpec> = [
  refusalFallbackDialogSpec,
  fableOverageConsentDialogSpec,
]

export function findDialogKindSpec(kind: string): DialogKindSpec | undefined {
  if (kind === MCP_URL_ELICITATION_DIALOG_KIND) {
    return mcpUrlElicitationDialogSpec
  }
  return USER_DIALOG_KIND_SPECS.find(s => s.kind === kind)
}

export type PrintRequestDialogHost = {
  handleElicitation: (
    serverName: string,
    message: string,
    requestedSchema: undefined,
    signal: AbortSignal | undefined,
    mode?: 'form' | 'url',
    url?: string,
    elicitationId?: string,
  ) => Promise<unknown>
  requestUserDialog: (
    dialogKind: string,
    payload: unknown,
    options?: { signal?: AbortSignal; toolUseId?: string },
  ) => Promise<{ behavior: 'completed' | 'cancelled'; result?: unknown }>
  /**
   * Official uY(CGn) — when a command is already queued, cancel user dialogs
   * with reason queued_at_park and return default.
   */
  peekQueuedCommand?: () => unknown | undefined
  cancelPendingUserDialogs?: (dialogKind: string, reason: string) => number
}

export type RequestDialogSpec = {
  kind: string
  default: unknown
  result?: () => {
    safeParse: (v: unknown) => { success: boolean; data?: unknown }
  }
}

export type RequestDialogOptions = {
  signal?: AbortSignal
}

/**
 * Official createPrintRequestDialog densable — returns async requestDialog.
 * Marks sdk dialog host active (Q8o) when first created by the caller.
 */
export function createPrintRequestDialog(
  host: PrintRequestDialogHost,
): (
  spec: RequestDialogSpec,
  payload: unknown,
  options?: RequestDialogOptions,
) => Promise<unknown> {
  return async function requestDialog(spec, payload, options) {
    // densable msf/UIb: while a known dialog is open, emit dialog needs for bg jobs
    const emitDialogNeeds = (kind: string | null) => {
      void import('./bgNeedsInputBridge.js').then(m => {
        if (!m.isBgJobSession()) return
        m.ensureBgNeedsPermissionBridge()
        m.emitBgNeedsFromDialogKind(kind)
      })
    }

    if (spec.kind === MCP_URL_ELICITATION_DIALOG_KIND) {
      const p = payload as {
        serverName?: string
        params?: {
          message?: string
          mode?: 'form' | 'url'
          url?: string
          elicitationId?: string
          _meta?: unknown
        }
      }
      if (!p?.serverName || !p.params) return spec.default
      emitDialogNeeds(MCP_URL_ELICITATION_DIALOG_KIND)
      try {
        return await host.handleElicitation(
          p.serverName,
          p.params.message ?? '',
          undefined,
          options?.signal,
          p.params.mode,
          p.params.url,
          p.params.elicitationId,
        )
      } finally {
        emitDialogNeeds(null)
      }
    }

    if (
      spec.kind === REFUSAL_FALLBACK_DIALOG_KIND ||
      spec.kind === FABLE_OVERAGE_CONSENT_DIALOG_KIND ||
      USER_DIALOG_KIND_SPECS.some(s => s.kind === spec.kind)
    ) {
      if (host.peekQueuedCommand?.() !== undefined) {
        host.cancelPendingUserDialogs?.(spec.kind, 'queued_at_park')
        return spec.default
      }
      emitDialogNeeds(spec.kind)
      try {
        const response = await host.requestUserDialog(spec.kind, payload, {
          signal: options?.signal,
        })
        if (response.behavior === 'cancelled') return spec.default
        if (spec.result) {
          const parsed = spec.result().safeParse(response.result)
          return parsed.success ? parsed.data : spec.default
        }
        const known = findDialogKindSpec(spec.kind)
        if (known?.parseResult) {
          const parsed = known.parseResult(response.result)
          return parsed.success ? parsed.data : spec.default
        }
        return response.result ?? spec.default
      } finally {
        emitDialogNeeds(null)
      }
    }

    return spec.default
  }
}

/** Zod payload schemas for known kinds (optional consumers / tests). */
export const refusalFallbackPayloadSchema = z.object({
  originalModel: z.string(),
  fallbackModel: z.string(),
  apiRefusalCategory: z.string().nullable().optional(),
  guidanceText: z.string().optional(),
  retractedMessageUuids: z.array(z.string()).optional(),
})

export const fableOverageConsentPayloadSchema = z.object({
  overagesEnabled: z.boolean(),
  balanceCents: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
})
