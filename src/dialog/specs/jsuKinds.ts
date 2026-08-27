/**
 * densable jsu non-permission DialogKindSpec set (from SEA Qg kinds).
 * Renderers live in DialogHost; tip UI components where already present.
 */
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
const ack = {
  result: () => z.literal('acknowledged'),
  default: 'acknowledged' as const,
}

/** densable _Bi */
export const it2SetupSpec = defineDialogSpec({
  kind: IT2_SETUP_KIND,
  payload: () =>
    z.object({ tmuxAvailable: z.boolean().optional() }).passthrough(),
  ...ack,
})

/** densable DIi */
export const computerUseApprovalSpec = defineDialogSpec({
  kind: COMPUTER_USE_APPROVAL_KIND,
  payload: passthrough,
  result: () => z.unknown(),
  default: null,
})

/** densable Wxt */
export const costThresholdSpec = defineDialogSpec({
  kind: COST_THRESHOLD_KIND,
  payload: passthrough,
  ...ack,
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
  result: () => z.unknown(),
  default: null,
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
  result: () => z.unknown(),
  default: null,
})

/** densable qSn */
export const autoDefaultNudgeSpec = defineDialogSpec({
  kind: AUTO_DEFAULT_NUDGE_KIND,
  payload: () =>
    z.object({ currentMode: z.unknown().optional() }).passthrough(),
  result: () => z.enum(['accepted', 'declined']),
  default: 'declined' as const,
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

/** densable Dot */
export const goalProposalSpec = defineDialogSpec({
  kind: GOAL_PROPOSAL_KIND,
  payload: passthrough,
  result: () => z.unknown(),
  default: null,
})

/** densable AEo */
export const autoModeSetupReviewSpec = defineDialogSpec({
  kind: AUTO_MODE_SETUP_REVIEW_KIND,
  payload: passthrough,
  result: () => z.unknown(),
  default: null,
})

/** densable TEo */
export const autoModeFlaggedAllowSpec = defineDialogSpec({
  kind: AUTO_MODE_FLAGGED_ALLOW_KIND,
  payload: passthrough,
  result: () => z.unknown(),
  default: null,
})

/** densable UOo */
export const peerInboundApprovalSpec = defineDialogSpec({
  kind: PEER_INBOUND_APPROVAL_KIND,
  payload: passthrough,
  result: () => z.unknown(),
  default: null,
})

/** densable jOo */
export const chromeInstallSetupSpec = defineDialogSpec({
  kind: CHROME_INSTALL_SETUP_KIND,
  payload: passthrough,
  result: () => z.unknown(),
  default: null,
})

/** densable zOo */
export const chromeInstallUpsellSpec = defineDialogSpec({
  kind: CHROME_INSTALL_UPSELL_KIND,
  payload: passthrough,
  result: () => z.unknown(),
  default: null,
})

export function isNonPermissionDialogKind(
  kind: string | undefined,
): kind is NonPermissionDialogKind {
  return (
    kind !== undefined &&
    (NON_PERMISSION_DIALOG_KINDS as readonly string[]).includes(kind)
  )
}
