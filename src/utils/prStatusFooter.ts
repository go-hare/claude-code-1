/**
 * densable prStatus / prNeedsAuth residual helpers (r6s / DXt / kin / Wxb).
 *
 * AppState mirrors PR poll results for footer consumers (left PrBadge path
 * still uses the hook; AppState enables copper_thistle / right-side reads).
 */
import type { PrReviewState } from './ghPrStatus.js'
import type { FooterLink } from './footerLinks.js'

/** densable kin — keyed sticky PR footer entry. */
export const CURRENT_PR_FOOTER_KEY = 'current-pr'

export type AppPrStatus = {
  number: number
  url: string
  reviewState?: PrReviewState | null
  /** densable kind — "cr" Code Review vs GitHub PR; local gh path leaves undefined. */
  kind?: string
}

/**
 * densable needsAuth stored on AppState — truthy string reason or false.
 * Boolean coercion matches densable `!K$e && Bqo && Rgn.needsAuth`.
 */
export type PrNeedsAuth = false | 'needs-auth' | 'gh-missing'

/** densable DXt — dim footer hint when PR badge cannot load. */
export function prNeedsAuthHint(reason: PrNeedsAuth | boolean | string | null | undefined): string | null {
  if (reason === 'needs-auth') return 'gh auth login for PR status'
  if (reason === 'gh-missing') return 'install gh for PR status'
  return null
}

/** densable ___ — map review state to theme color token for footer link. */
export function prReviewStateColor(
  reviewState: PrReviewState | null | undefined,
): FooterLink['color'] {
  switch (reviewState) {
    case 'approved':
      return 'success'
    case 'changes_requested':
      return 'error'
    case 'pending':
      return 'warning'
    case 'merged':
      return 'merged'
    default:
      return undefined
  }
}

/**
 * densable r6s — build keyed PR footer entry from status + display URL.
 * Returns null when status/url missing (caller removes keyed link).
 */
export function buildPrFooterLink(
  pr: AppPrStatus | null | undefined,
  displayUrl: string | undefined | null,
): Omit<FooterLink, 'key'> | null {
  if (!pr || !displayUrl) return null
  return {
    prefix: 'PR',
    label: `#${pr.number}`,
    url: displayUrl,
    dedupUrl: pr.url,
    color: prReviewStateColor(pr.reviewState ?? undefined),
  }
}

/**
 * densable f$t — AppState prNeedsAuth value: reason only when no PR badge and
 * PR status feature enabled and poll reported auth/gh missing.
 */
export function computeAppPrNeedsAuth(args: {
  pr: AppPrStatus | null | undefined
  prStatusEnabled: boolean
  needsAuth: PrNeedsAuth | false
}): PrNeedsAuth {
  if (args.pr) return false
  if (!args.prStatusEnabled) return false
  if (args.needsAuth === 'needs-auth' || args.needsAuth === 'gh-missing') {
    return args.needsAuth
  }
  return false
}
