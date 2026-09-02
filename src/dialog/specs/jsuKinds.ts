/**
 * densable jsu non-permission DialogKindSpec set (from SEA Qg kinds).
 * Renderers live in DialogHost; tip UI components where already present.
 */
import { DEFAULT_GRANT_FLAGS } from '@ant/computer-use-mcp/types'
import { z } from 'zod/v4'
import { defineDialogSpec } from '../requestDialog.js'

export const IT2_SETUP_KIND = 'it2_setup' as const
export const COMPUTER_USE_APPROVAL_KIND = 'computer_use_approval' as const
export const COST_THRESHOLD_KIND = 'cost_threshold' as const
export const RESUME_RETURN_KIND = 'resume_return' as const
export const IDE_ONBOARDING_KIND = 'ide_onboarding' as const
export const SANDBOX_NETWORK_ACCESS_KIND = 'sandbox_network_access' as const
export const AUTO_DEFAULT_NUDGE_KIND = 'auto_default_nudge' as const
export const MCP_URL_ELICITATION_KIND = 'mcp_url_elicitation' as const
export const REFUSAL_FALLBACK_PROMPT_KIND = 'refusal_fallback_prompt' as const
export const FABLE_OVERAGE_CONSENT_PROMPT_KIND =
  'fable_overage_consent_prompt' as const
export const GOAL_PROPOSAL_KIND = 'goal_proposal' as const
export const AUTO_MODE_SETUP_REVIEW_KIND = 'auto_mode_setup_review' as const
export const AUTO_MODE_FLAGGED_ALLOW_KIND = 'auto_mode_flagged_allow' as const
export const PEER_INBOUND_APPROVAL_KIND = 'peer_inbound_approval' as const
export const CHROME_INSTALL_SETUP_KIND = 'chrome_install_setup' as const
export const CHROME_INSTALL_UPSELL_KIND = 'chrome_install_upsell' as const

export const NON_PERMISSION_DIALOG_KINDS = [
  IT2_SETUP_KIND,
  COMPUTER_USE_APPROVAL_KIND,
  COST_THRESHOLD_KIND,
  RESUME_RETURN_KIND,
  IDE_ONBOARDING_KIND,
  SANDBOX_NETWORK_ACCESS_KIND,
  AUTO_DEFAULT_NUDGE_KIND,
  MCP_URL_ELICITATION_KIND,
  REFUSAL_FALLBACK_PROMPT_KIND,
  FABLE_OVERAGE_CONSENT_PROMPT_KIND,
  GOAL_PROPOSAL_KIND,
  AUTO_MODE_SETUP_REVIEW_KIND,
  AUTO_MODE_FLAGGED_ALLOW_KIND,
  PEER_INBOUND_APPROVAL_KIND,
  CHROME_INSTALL_SETUP_KIND,
  CHROME_INSTALL_UPSELL_KIND,
] as const

export type NonPermissionDialogKind =
  (typeof NON_PERMISSION_DIALOG_KINDS)[number]

const passthrough = () => z.record(z.string(), z.unknown())

/** densable _Bi — result Or(["installed","use-tmux","cancelled"]), default cancelled */
export const it2SetupSpec = defineDialogSpec({
  kind: IT2_SETUP_KIND,
  payload: () => z.object({ tmuxAvailable: z.boolean() }).passthrough(),
  result: () => z.enum(['installed', 'use-tmux', 'cancelled']),
  default: 'cancelled' as const,
})

/** densable DIi — payload/result iU(object); default {granted:[],denied:[],flags:uIe} */
export const computerUseApprovalSpec = defineDialogSpec({
  kind: COMPUTER_USE_APPROVAL_KIND,
  payload: passthrough,
  result: () => z.unknown(),
  default: { granted: [], denied: [], flags: DEFAULT_GRANT_FLAGS },
})

/** densable Wxt — Esc/dismiss is cancelled (oXg); Got it is acknowledged. */
export const costThresholdSpec = defineDialogSpec({
  kind: COST_THRESHOLD_KIND,
  payload: passthrough,
  result: () => z.union([z.literal('acknowledged'), z.literal('cancelled')]),
  default: 'cancelled' as const,
})

/** densable Gxt */
export const resumeReturnSpec = defineDialogSpec({
  kind: RESUME_RETURN_KIND,
  payload: () =>
    z
      .object({
        sessionAgeMinutes: z.number().optional(),
        estimatedTokens: z.number().optional(),
      })
      .passthrough(),
  result: () =>
    z.enum(['compact', 'continue', 'dismiss', 'never', 'cancelled']),
  default: 'cancelled' as const,
})

/** densable CHr */
export const ideOnboardingSpec = defineDialogSpec({
  kind: IDE_ONBOARDING_KIND,
  payload: () =>
    z.object({ installationStatus: z.unknown().optional() }).passthrough(),
  result: () => z.literal('dismissed'),
  default: 'dismissed' as const,
})

/** densable FRr */
export const sandboxNetworkAccessSpec = defineDialogSpec({
  kind: SANDBOX_NETWORK_ACCESS_KIND,
  payload: () =>
    z.object({ host: z.string(), port: z.unknown().optional() }).passthrough(),
  result: () =>
    z.union([
      z.object({
        allow: z.boolean(),
        persistToSettings: z.boolean(),
        persistRow: z.unknown().optional(),
      }),
      z.literal('cancelled'),
    ]),
  default: 'cancelled' as const,
})

/** densable qSn — Esc/dismiss is cancelled; lHr treats it as decline + latch. */
export const autoDefaultNudgeSpec = defineDialogSpec({
  kind: AUTO_DEFAULT_NUDGE_KIND,
  payload: () =>
    z.object({ currentMode: z.unknown().optional() }).passthrough(),
  result: () => z.enum(['accepted', 'declined', 'cancelled']),
  default: 'cancelled' as const,
})

/** densable Gbt */
export const mcpUrlElicitationSpec = defineDialogSpec({
  kind: MCP_URL_ELICITATION_KIND,
  payload: passthrough,
  result: () => z.unknown(),
  default: { action: 'cancel' as const },
})

/** densable $ne */
export const refusalFallbackPromptSpec = defineDialogSpec({
  kind: REFUSAL_FALLBACK_PROMPT_KIND,
  payload: passthrough,
  result: () => z.enum(['retry_fallback', 'edit_prompt', 'cancelled']),
  default: 'cancelled' as const,
})

/** densable tbt */
export const fableOverageConsentPromptSpec = defineDialogSpec({
  kind: FABLE_OVERAGE_CONSENT_PROMPT_KIND,
  payload: passthrough,
  result: () => z.enum(['consent', 'switch_default', 'cancelled']),
  default: 'cancelled' as const,
})

/** densable Dot — result {approved, explicit?}, default {approved:false} */
export const goalProposalSpec = defineDialogSpec({
  kind: GOAL_PROPOSAL_KIND,
  payload: () => z.object({ condition: z.string() }).passthrough(),
  result: () =>
    z.object({
      approved: z.boolean(),
      explicit: z.boolean().optional(),
    }),
  default: { approved: false },
})

/** densable AEo — result Or(["accept","decline","cancelled"]), default cancelled */
export const autoModeSetupReviewSpec = defineDialogSpec({
  kind: AUTO_MODE_SETUP_REVIEW_KIND,
  payload: passthrough,
  result: () => z.enum(['accept', 'decline', 'cancelled']),
  default: 'cancelled' as const,
})

/** densable TEo — result Es([{toRemove:string[]}, "cancelled"]), default cancelled */
export const autoModeFlaggedAllowSpec = defineDialogSpec({
  kind: AUTO_MODE_FLAGGED_ALLOW_KIND,
  payload: () =>
    z.object({ flagged: z.array(z.string()), runId: z.string() }).passthrough(),
  result: () =>
    z.union([
      z.object({ toRemove: z.array(z.string()) }),
      z.literal('cancelled'),
    ]),
  default: 'cancelled' as const,
})

/** densable UOo */
export const peerInboundApprovalSpec = defineDialogSpec({
  kind: PEER_INBOUND_APPROVAL_KIND,
  payload: () =>
    z.object({ holdCause: z.unknown(), preview: z.string() }).passthrough(),
  result: () =>
    z.object({
      behavior: z.enum(['approve', 'deny', 'cancelled']),
    }),
  default: { behavior: 'cancelled' as const },
})

/** densable jOo */
export const chromeInstallSetupSpec = defineDialogSpec({
  kind: CHROME_INSTALL_SETUP_KIND,
  payload: () =>
    z.object({
      phase: z.enum([
        'waiting_install',
        'connecting',
        'stalled',
        'connected',
        'failed',
      ]),
      installPageOpened: z.boolean(),
    }),
  result: () => z.enum(['continue', 'keep_waiting', 'skip', 'cancelled']),
  default: 'cancelled' as const,
})

/** densable zOo */
export const chromeInstallUpsellSpec = defineDialogSpec({
  kind: CHROME_INSTALL_UPSELL_KIND,
  payload: passthrough,
  result: () => z.enum(['install', 'not_now', 'dont_ask_again', 'cancelled']),
  default: 'cancelled' as const,
})

export function isNonPermissionDialogKind(
  kind: string | undefined,
): kind is NonPermissionDialogKind {
  return (
    kind !== undefined &&
    (NON_PERMISSION_DIALOG_KINDS as readonly string[]).includes(kind)
  )
}

/** densable i_y — soft kinds keep PromptInput (Wxt / Gxt / qSn / CHr). */
const SOFT_NMS_KINDS = new Set<string>([
  COST_THRESHOLD_KIND,
  RESUME_RETURN_KIND,
  AUTO_DEFAULT_NUDGE_KIND,
  IDE_ONBOARDING_KIND,
])

export function isSoftNmsDialogKind(kind: string | undefined): boolean {
  return kind !== undefined && SOFT_NMS_KINDS.has(kind)
}
