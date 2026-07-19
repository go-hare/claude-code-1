/**
 * densable Mtn / tengu_amber_quill — gate for classifier-driven context tips
 * on the spinner.
 *
 * densable: Mtn() {
 *   if (vf()) return false;                 // non-interactive / print path
 *   if (!Wi("allow_context_tips")) return false;
 *   return et("tengu_amber_quill", false);
 * }
 *
 * Full tip classifier (iWd/rWd) is a larger residual; this module only
 * exposes the enable gate so Spinner/scheduler can share densable polarity.
 */

import { isPolicyAllowed } from '../services/policyLimits/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

/** densable vf-ish: headless/print paths never show interactive context tips. */
function isNonInteractiveSession(): boolean {
  // CLAUDE_CODE_ENTRYPOINT=cli is normal interactive; sdk/print/headless skip.
  const ep = process.env.CLAUDE_CODE_ENTRYPOINT
  if (ep === 'sdk' || ep === 'print' || ep === 'headless') return true
  if (process.env.CI === 'true' && process.env.CLAUDE_CODE_FORCE_TIPS !== '1') {
    // keep CI deterministic unless forced
  }
  return false
}

/** densable Mtn — amber_quill context tips master gate. */
export function isAmberQuillContextTipsEnabled(
  opts: {
    nonInteractive?: boolean
    policyAllowed?: boolean
    gbValue?: boolean
  } = {},
): boolean {
  const nonInteractive = opts.nonInteractive ?? isNonInteractiveSession()
  if (nonInteractive) return false
  const policy =
    opts.policyAllowed ?? isPolicyAllowed('allow_context_tips')
  if (!policy) return false
  return (
    opts.gbValue ??
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_quill', false)
  )
}
