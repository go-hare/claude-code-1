/**
 * densable urr / oEn — background reattach carries the parent's subscription
 * and rate-limit tier. oI / iI read them only for CLAUDE_CODE_SESSION_KIND=bg.
 */
export const BG_DISPATCHER_SUBSCRIPTION_TYPE =
  'CLAUDE_BG_DISPATCHER_SUBSCRIPTION_TYPE'
export const BG_DISPATCHER_RATE_LIMIT_TIER =
  'CLAUDE_BG_DISPATCHER_RATE_LIMIT_TIER'

/** densable kte */
export const DISPATCHER_RATE_LIMIT_TIER_RE = /^[a-z][a-z0-9_]{0,63}$/

export type DispatcherAccount = {
  subscriptionType: string | null
  rateLimitTier: string | null
}

/** densable oEn */
export function readBgDispatcherAccount(env: NodeJS.ProcessEnv = process.env): {
  subscriptionType: string | undefined
  rateLimitTier: string | undefined
} {
  if (env.CLAUDE_CODE_SESSION_KIND !== 'bg') {
    return { subscriptionType: undefined, rateLimitTier: undefined }
  }
  return {
    subscriptionType: env[BG_DISPATCHER_SUBSCRIPTION_TYPE] || undefined,
    rateLimitTier: env[BG_DISPATCHER_RATE_LIMIT_TIER] || undefined,
  }
}

/** densable urr */
export function dispatcherReattachEnv(
  account: DispatcherAccount,
): Record<string, string> {
  return {
    ...(account.subscriptionType
      ? { [BG_DISPATCHER_SUBSCRIPTION_TYPE]: account.subscriptionType }
      : {}),
    ...(account.rateLimitTier
      ? { [BG_DISPATCHER_RATE_LIMIT_TIER]: account.rateLimitTier }
      : {}),
  }
}

/** densable oI switch, after the caller has applied Yp. */
export function mapDispatcherSubscriptionType(
  subscriptionType: string | undefined,
): 'max' | 'pro' | 'team' | 'enterprise' | null {
  switch (subscriptionType) {
    case 'max':
      return 'max'
    case 'pro':
      return 'pro'
    case 'team':
      return 'team'
    case 'enterprise':
      return 'enterprise'
    default:
      return null
  }
}

/** densable iI tier check, after the caller has applied Yp. */
export function mapDispatcherRateLimitTier(
  rateLimitTier: string | undefined,
): string | null {
  if (
    rateLimitTier !== undefined &&
    DISPATCHER_RATE_LIMIT_TIER_RE.test(rateLimitTier)
  ) {
    return rateLimitTier
  }
  return null
}

/**
 * densable So `reattachEnv: {...caller, ...!exec && urr(account)}`.
 * `awn()` is not in the gold excerpt; the caller supplies the account.
 */
export function reattachEnvWithDispatcherAccount(
  caller: Record<string, string> | undefined,
  exec: string | undefined,
  account: DispatcherAccount,
): Record<string, string> | undefined {
  const merged: Record<string, string> = {
    ...(caller ?? {}),
    ...(exec ? {} : dispatcherReattachEnv(account)),
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * densable $n tail: `token.subscriptionType ?? oI() ?? null`.
 * oI / iI start with `if (!Yp())` — caller passes that as dispatcherTrusted.
 */
export function subscriptionFromTokenOrDispatcher(
  tokenSubscription: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  dispatcherTrusted = true,
): string | null {
  if (tokenSubscription != null) return tokenSubscription
  if (!dispatcherTrusted) return null
  return mapDispatcherSubscriptionType(
    readBgDispatcherAccount(env).subscriptionType,
  )
}

/**
 * densable token tier ?? iI(). iI starts with `if (!Yp())`.
 */
export function rateLimitTierFromTokenOrDispatcher(
  tokenTier: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  dispatcherTrusted = true,
): string | null {
  if (tokenTier != null) return tokenTier
  if (!dispatcherTrusted) return null
  return mapDispatcherRateLimitTier(readBgDispatcherAccount(env).rateLimitTier)
}
