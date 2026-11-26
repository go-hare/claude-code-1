/**
 * Official 2.1.331 Approval Card Minimum Read-Delay Guard (`10_allow_card_read_delay.js`):
 * Implements `ao` / `hr` / `dr` / `ls` — protects high-impact approval cards
 * (such as `/ship` push/PR confirmation) against accidental or clickjacked
 * instant-Allow responses (`< 3500ms`), stale answers (`> 600000ms`), mid-flight
 * session/rule changes, and approval token replay.
 */

/** Official 2.1.331 `ar` hosts supporting local approval cards. */
export const APPROVAL_CARD_ALLOWED_HOSTS = [
  'claude-vscode',
  'claude-desktop',
] as const

/** Official 2.1.331 `hr` minimum milliseconds the card must remain open before Allow is accepted. */
export const APPROVAL_CARD_MIN_READ_DELAY_MS = 3500

/** Official 2.1.331 `dr` maximum milliseconds an Allow remains valid (10 minutes). */
export const APPROVAL_CARD_MAX_WAIT_MS = 600_000

/** Official 2.1.331 `Ct` */
export const APPROVAL_CARD_STALE_OR_CHANGED_MESSAGE =
  'That answer came too late, or this session changed meanwhile.'

/** Official 2.1.331 `vn` */
export const APPROVAL_CARD_TOO_FAST_MESSAGE =
  'That Allow came before the card could be read.'

/** Official 2.1.331 `Rn` */
export const APPROVAL_CARD_UNREADABLE_ANSWER_MESSAGE =
  '/ship got no answer that it could read as Allow or Deny.'

/** Official 2.1.331 `zt` */
export const APPROVAL_CARD_PUBLIC_REPO_MESSAGE =
  "This repository is public, and from this window /ship doesn't push to a public one."

/** Official 2.1.331 `so` */
export const APPROVAL_CARD_DECLINED_MESSAGE = "You didn't pick Allow."

/** Official 2.1.331 `io` */
export const APPROVAL_CARD_NEW_BRANCH_LABEL = 'a new branch'

/** Official 2.1.331 `In` */
export const APPROVAL_CARD_COMMIT_PUSH_PR_QUESTION =
  'Commit your changes, push them and open a pull request, as you?'

/** Official 2.1.331 `ro` */
export const APPROVAL_CARD_PUSH_PR_QUESTION =
  'Push your commits and open a pull request, as you?'

export type ApprovalCardChoiceValue = 'deny' | 'allow'

export type ApprovalCardPromptRequest = {
  source: string
  header: string
  question: string
  choices: [
    { value: 'deny'; label: 'Deny' },
    { value: 'allow'; label: 'Allow'; description: string },
  ]
  personOnly: true
  defaultToNo: true
}

export type ApprovalCardPromptAnswer =
  | { kind: 'chose'; value: ApprovalCardChoiceValue }
  | { kind: 'declined'; typedAnswer?: string }
  | { kind: 'aborted' }
  | {
      kind: 'unanswered'
      reason: 'no_one_to_ask' | 'error' | 'no_selection' | 'host_closed'
    }

export type ApprovalCardStopResult =
  | { word: 'stopped'; text: string }
  | { word: 'no_answer'; text: '' }

export type ApprovalCardEnv = {
  askPerson?: (
    request: ApprovalCardPromptRequest,
  ) => Promise<ApprovalCardPromptAnswer>
  /** Official `Lt(e) !== undefined` — true when session context changed or became ineligible. */
  sessionChanged: () => boolean
  /** Official `e.rulesStillAllow()` — re-verifies permission rules after Allow arrives. */
  rulesStillAllow: () => Promise<boolean> | boolean
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  now?: () => number
  /** Optional override for minimum read delay (defaults to 3500ms). */
  minReadDelayMs?: number
  /** Optional override for maximum wait time (defaults to 600000ms). */
  maxWaitMs?: number
}

/** Official 2.1.331 `ls`: one-time WeakSet of frozen approval tokens issued by `ao`. */
const issuedApprovalCardTokens = new WeakSet<object>()

/** Returns true if `token` is a live, unconsumed token issued by `requestApprovalCardWithReadDelay`. */
export function isIssuedApprovalCardToken(token: unknown): boolean {
  return (
    typeof token === 'object' &&
    token !== null &&
    issuedApprovalCardTokens.has(token)
  )
}

/**
 * Official 2.1.331 `ls.delete(token)`: consumes a one-time approval token.
 * Returns true only on the first consumption of a genuinely issued token.
 */
export function consumeApprovalCardToken(token: unknown): boolean {
  if (typeof token !== 'object' || token === null) return false
  return issuedApprovalCardTokens.delete(token)
}

/**
 * Official 2.1.331 `ao(env, { question, row, ...payload })`:
 * Displays a `personOnly`, `defaultToNo` approval card and enforces:
 * 1. Pre-check that `askPerson` exists and the session has not changed (`Ct`)
 * 2. Minimum read delay `< 3500ms` (`hr`) → stops with `vn`
 * 3. Post-check that session did not change, rules still allow, and wait did
 *    not exceed `600000ms` (`dr`) → stops with `Ct`
 * 4. Returns a frozen one-time token registered in `issuedApprovalCardTokens` (`ls`)
 */
export async function requestApprovalCardWithReadDelay<
  Payload extends Record<string, unknown>,
>(
  env: ApprovalCardEnv,
  card: {
    question: string
    row: string
    source?: string
    header?: string
    payload: Payload
  },
): Promise<Readonly<Payload> | ApprovalCardStopResult> {
  const { askPerson } = env
  if (askPerson === undefined || env.sessionChanged()) {
    return { word: 'stopped', text: APPROVAL_CARD_STALE_OR_CHANGED_MESSAGE }
  }
  const now = env.now ?? Date.now
  const minReadDelayMs = env.minReadDelayMs ?? APPROVAL_CARD_MIN_READ_DELAY_MS
  const maxWaitMs = env.maxWaitMs ?? APPROVAL_CARD_MAX_WAIT_MS

  const shownAt = now()
  const answer = await askPerson({
    source: card.source ?? 'ship_local_put_up',
    header: card.header ?? '/ship',
    question: card.question,
    choices: [
      { value: 'deny', label: 'Deny' },
      { value: 'allow', label: 'Allow', description: card.row },
    ],
    personOnly: true,
    defaultToNo: true,
  })

  if (answer.kind === 'chose' && answer.value === 'allow') {
    if (now() - shownAt < minReadDelayMs) {
      return { word: 'stopped', text: APPROVAL_CARD_TOO_FAST_MESSAGE }
    }
    if (
      env.sessionChanged() ||
      !(await env.rulesStillAllow()) ||
      now() - shownAt > maxWaitMs
    ) {
      return { word: 'stopped', text: APPROVAL_CARD_STALE_OR_CHANGED_MESSAGE }
    }
    const frozenToken = Object.freeze({ ...card.payload })
    issuedApprovalCardTokens.add(frozenToken)
    return frozenToken
  }

  if (answer.kind !== 'unanswered') {
    return { word: 'stopped', text: APPROVAL_CARD_DECLINED_MESSAGE }
  }
  return answer.reason === 'host_closed'
    ? { word: 'no_answer', text: '' }
    : { word: 'stopped', text: APPROVAL_CARD_UNREADABLE_ANSWER_MESSAGE }
}
