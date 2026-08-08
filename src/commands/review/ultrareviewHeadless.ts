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
import {
  checkOverageGate,
  isUltrareviewOverageConfirmed,
  launchRemoteReview,
  markUltrareviewOverageConfirmed,
  parseUltrareviewArgs,
  ultrareviewLaunchAcknowledgementNudge,
} from './reviewRemote.js'

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
