/**
 * densable 2.1.218 #8 — non-interactive /ultrareview (type: local, supportsNonInteractive).
 *
 * densable eGd/Pvy:
 * - parse flags via uun
 * - launch via overage gate path with confirm:true + withhold dialog
 * - needs-confirm → text telling user to consent interactively
 * - launched → type:query with launch message + dun nudge prompt
 */
import type { LocalCommandCall } from '../../types/command.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { logEvent } from '../../services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { checkHasTrustDialogAccepted } from '../../utils/config.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  checkOverageGate,
  isUltrareviewOverageConfirmed,
  launchRemoteReview,
  markUltrareviewOverageConfirmed,
  parseUltrareviewArgs,
  ultrareviewLaunchAcknowledgementNudge,
} from './reviewRemote.js'

// ---------------------------------------------------------------------------
// #1170: claude ultrareview --trust-workspace (official ZIr / Oe)
// ---------------------------------------------------------------------------

export function shouldRunUltrareviewTrustCheck(): boolean {
  const disabled = process.env.CLAUDE_CODE_DISABLE_ULTRAREVIEW_TRUST_CHECK
  if (!disabled) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_twinkly_breeze', false)) {
      return true
    }
  }
  logEvent('cli_ultrareview_workspace_trust', {
    reason: disabled ? 'check_switched_off_by_env' : 'check_switched_off',
  })
  return false
}

export function validateTrustWorkspaceFlag(
  argv: readonly string[],
  trustWorkspace: boolean | undefined,
  jsonMode = false,
): string | null {
  const trailing = argv.find(
    (arg, idx) => argv[idx - 1] === '--trust-workspace' && !/^-./.test(arg),
  )
  if (trustWorkspace === true && trailing !== undefined) {
    logEvent('cli_ultrareview', { reason: 'trust_flag_given_a_value' })
    const hint = jsonMode
      ? ''
      : ' To trust it for this run, put nothing after the flag: a PR number or base branch goes before it.'
    return `Ultrareview did not start: \`--trust-workspace\` takes no value, but ${JSON.stringify(trailing)} follows it. If you do not trust this folder, leave the flag out.${hint}`
  }
  return null
}

export function checkUltrareviewWorkspaceTrust(opts: {
  trustWorkspace?: boolean
  argv?: readonly string[]
  isTrusted?: () => boolean
  shouldCheck?: () => boolean
  canPrompt?: boolean
  jsonMode?: boolean
}): { trusted: true } | { trusted: false; reason: string; message: string } {
  const flagError = validateTrustWorkspaceFlag(
    opts.argv ?? [],
    opts.trustWorkspace,
    opts.jsonMode ?? false,
  )
  if (flagError !== null) {
    return {
      trusted: false,
      reason: 'trust_flag_given_a_value',
      message: flagError,
    }
  }
  const isTrusted = opts.isTrusted ?? checkHasTrustDialogAccepted
  if (isTrusted()) {
    return { trusted: true }
  }
  if (opts.trustWorkspace === true) {
    logEvent('cli_ultrareview_workspace_trust', { trust_source: 'flag' })
    return { trusted: true }
  }
  const canPrompt = (opts.canPrompt ?? false) && !isEnvTruthy(process.env.CI)
  const shouldCheck = opts.shouldCheck ?? shouldRunUltrareviewTrustCheck
  if (canPrompt || shouldCheck()) {
    if (!canPrompt) {
      const remedy = opts.jsonMode
        ? ''
        : ' Or, in a script or CI job, pass `--trust-workspace` to trust the folder for this run only.'
      const message =
        'Ultrareview runs git in this folder to collect your changes: ' +
        "This folder's git settings can make git run other programs. Trusting the folder also applies to Claude Code: sessions started here can read, edit, and execute files, and this folder's project settings (hooks, MCP servers, permission rules, helper commands) apply to them." +
        remedy
      logEvent('cli_ultrareview', { reason: 'workspace_not_trusted' })
      return { trusted: false, reason: 'workspace_not_trusted', message }
    }
  }
  return { trusted: true }
}

function contentBlocksToString(
  blocks: Array<{ type: string; text?: string }>,
): string {
  return blocks
    .map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n')
}

/**
 * densable Pvy — headless ultrareview call.
 * Invocation label prefers `/code-review ultra` when that is how the user arrived.
 */
export const call: LocalCommandCall = async (args, context) => {
  const invocation = '/code-review ultra'
  const { scopeArgs, applyFixes } = parseUltrareviewArgs(args)

  const gate = await checkOverageGate({
    overageConfirmed: isUltrareviewOverageConfirmed(context),
  })

  switch (gate.kind) {
    case 'not-enabled':
      return {
        type: 'text',
        value:
          'Free ultrareviews used. Enable Extra Usage at https://claude.ai/settings/billing to continue.',
      }
    case 'blocked':
      return {
        type: 'text',
        value: gate.actionUrl
          ? `${gate.message}\n  → ${gate.actionUrl}`
          : gate.message,
      }
    case 'low-balance':
      return {
        type: 'text',
        value: `Balance too low to launch ultrareview ($${gate.available.toFixed(2)} available, $10 minimum). Top up at https://claude.ai/settings/billing`,
      }
    case 'needs-confirm': {
      // densable: non-interactive cannot show UltrareviewOverageDialog
      const tip = getIsNonInteractiveSession()
        ? 'Run "claude ultrareview" from your terminal to consent and launch, or use /ultrareview in an interactive Claude Code session.'
        : 'Run /ultrareview to confirm and launch the cloud review.'
      const body =
        gate.body && gate.body.length > 0
          ? gate.body
          : 'This review requires Extra Usage billing confirmation.'
      return {
        type: 'text',
        value: `${body} ${invocation} can't show the billing confirmation in this session. ${tip}`,
      }
    }
    case 'proceed':
      break
  }

  const billingNote = gate.billingNote ?? ''
  const result = await launchRemoteReview(scopeArgs, context, billingNote, {
    invocation,
    applyFixesOnComplete: applyFixes,
  })

  if (!result) {
    return {
      type: 'text',
      value:
        'Ultrareview failed to launch the remote session. Check that this is a GitHub repo and try again.',
    }
  }

  markUltrareviewOverageConfirmed(context)
  const message = contentBlocksToString(result)
  return {
    type: 'query',
    value: message,
    prompt: ultrareviewLaunchAcknowledgementNudge(applyFixes),
  }
}
