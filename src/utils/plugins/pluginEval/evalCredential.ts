/**
 * densable eval `xa` / `zi` / `ap` — credential resolve, tokenGate semaphore,
 * child injector. Coordinator owns 4-pipe stdio when `viaFd`.
 *
 * Gold `op` extra FD is 3 (`String(op)`). Do not mint tokens.
 */
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getClaudeAIOAuthTokens,
  checkAndRefreshOAuthTokenIfNeeded,
  hasAnthropicApiKeyAuth,
} from '../../auth.js'
import { logForDebugging } from '../../debug.js'
import {
  getGatewayAuth,
  maybeRefreshGatewayIdp,
  type GatewayAuthSession,
} from '../../gatewayEnv.js'
import { getPlatform } from '../../platform.js'

/** densable `Ud` @4096 — skew added to run timeout when judging expiry. */
const EVAL_CREDENTIAL_SKEW_MS = 300_000
/** densable `Jm` @9759. */
const TOKEN_GATE_BACKOFF_MS = 60_000
/** densable `op` — extra stdio slot after stdin/stdout/stderr. */
export const EVAL_CREDENTIAL_FD = 3

export type EvalCredential =
  | { kind: 'gateway'; url: string; jwt: string; warning?: string }
  | {
      kind: 'oauth'
      accessToken: string
      scopes: string[]
      subscriptionType: string | null
      rateLimitTier: string | null
      warning?: string
    }

export type EvalCredentialInject = {
  env: Record<string, string>
  viaFd: boolean
  cleanup: () => Promise<void>
}

type TokenGateSkip = { expiry: number; until: number }

/**
 * densable `zi` — holders wait out a single in-flight refresh.
 */
export class EvalTokenGate {
  private holders = 0
  private rotation: Promise<void> | null = null
  private drainedWaiters: Array<() => void> = []
  private skip: TokenGateSkip | null = null
  constructor(private readonly retryBackoffMs = TOKEN_GATE_BACKOFF_MS) {}

  async enter(): Promise<void> {
    while (this.rotation !== null) await this.rotation.catch(() => {})
    this.holders++
  }

  leave(): void {
    this.holders--
    if (this.holders === 0) {
      const waiters = this.drainedWaiters
      this.drainedWaiters = []
      for (const wake of waiters) wake()
    }
  }

  async rotate(
    expiry: number,
    neededUntil: number,
    refresh: () => Promise<number | null>,
  ): Promise<void> {
    if (
      this.skip !== null &&
      this.skip.expiry === expiry &&
      Date.now() < this.skip.until
    ) {
      return
    }
    this.leave()
    try {
      this.rotation ??= (async () => {
        if (this.holders > 0) {
          await new Promise<void>(resolve => {
            this.drainedWaiters.push(resolve)
          })
        }
        let next: number | null
        try {
          next = await refresh()
        } catch (error) {
          logForDebugging(
            `eval: login refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            { level: 'error' },
          )
          next = expiry
        }
        if (next === null || next <= expiry) {
          this.skip = {
            expiry,
            until: Date.now() + this.retryBackoffMs,
          }
        } else if (next < neededUntil) {
          this.skip = { expiry: next, until: Number.POSITIVE_INFINITY }
        } else {
          this.skip = null
        }
      })().finally(() => {
        this.rotation = null
      })
      await this.rotation
    } finally {
      this.holders++
    }
  }

  get holding(): number {
    return this.holders
  }
}

function neededUntilMs(timeoutSeconds: number): number {
  return Date.now() + timeoutSeconds * 1000 + EVAL_CREDENTIAL_SKEW_MS
}

function minutesLeft(expiresAt: number): number {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 60_000))
}

/** densable `xa` OAuth warning copy. */
export function evalOauthExpiryWarning(
  minutes: number,
  timeoutSeconds: number,
): string {
  return `login token expires in ~${minutes} min, before this run's ${timeoutSeconds}s timeout; a long run may lose auth part-way (run /login to renew)`
}

/** densable `xa` gateway warning copy. */
export function evalGatewayExpiryWarning(
  minutes: number,
  timeoutSeconds: number,
  canRenew: boolean,
): string {
  return `gateway session expires in ~${minutes} min, before this run's ${timeoutSeconds}s timeout; a long run may lose auth part-way${canRenew ? '' : ' (run /login to renew)'}`
}

function envAlreadyInjectsKey(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR ||
      process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR ||
      process.env.CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR ||
      process.env.ANTHROPIC_UNIX_SOCKET ||
      process.env.ANTHROPIC_AUTH_TOKEN,
  )
}

/**
 * densable `xa(credentials, timeoutSeconds, rotate)`.
 * Skips injector when an API key / existing FD / unix-socket already authenticates.
 */
export async function resolveEvalCredential(
  timeoutSeconds: number,
  rotate: EvalTokenGate['rotate'],
): Promise<EvalCredential | null> {
  const until = () => neededUntilMs(timeoutSeconds)
  const gateway = getGatewayAuth()
  if (gateway) {
    if (gateway.idpRefreshToken && gateway.expiresAtMs < until()) {
      await rotate(gateway.expiresAtMs, until(), async () => {
        await maybeRefreshGatewayIdp()
        return getGatewayAuth()?.expiresAtMs ?? null
      })
    } else {
      await maybeRefreshGatewayIdp()
    }
    const session: GatewayAuthSession = getGatewayAuth() ?? gateway
    let warning: string | undefined
    if (session.expiresAtMs < until()) {
      warning = evalGatewayExpiryWarning(
        minutesLeft(session.expiresAtMs),
        timeoutSeconds,
        Boolean(session.idpRefreshToken),
      )
      logForDebugging(`[eval] ${warning}`, { level: 'warn' })
    }
    return {
      kind: 'gateway',
      url: session.url,
      jwt: session.jwt,
      ...(warning !== undefined ? { warning } : {}),
    }
  }
  if (hasAnthropicApiKeyAuth() || envAlreadyInjectsKey()) return null
  const tokens = getClaudeAIOAuthTokens()
  if (!tokens?.accessToken) return null
  let current = tokens
  let warning: string | undefined
  if (current.expiresAt !== null && current.expiresAt < until()) {
    if (current.refreshToken) {
      await rotate(current.expiresAt, until(), async () => {
        await checkAndRefreshOAuthTokenIfNeeded(0, true)
        return getClaudeAIOAuthTokens()?.expiresAt ?? null
      })
      current = getClaudeAIOAuthTokens() ?? current
      if (!current.accessToken) return null
    }
    if (current.expiresAt !== null && current.expiresAt < until()) {
      warning = evalOauthExpiryWarning(
        minutesLeft(current.expiresAt),
        timeoutSeconds,
      )
      logForDebugging(`[eval] ${warning}`, { level: 'warn' })
    }
  }
  return {
    kind: 'oauth',
    accessToken: current.accessToken,
    scopes: Array.isArray(current.scopes) ? current.scopes : [],
    subscriptionType: current.subscriptionType ?? null,
    rateLimitTier: current.rateLimitTier ?? null,
    ...(warning !== undefined ? { warning } : {}),
  }
}

/**
 * densable `ap`. Unix: announce extra FD 3 (`viaFd`). Windows: wx snapshot.
 * Coordinator writes the token onto stdio[3] when viaFd.
 */
export async function injectEvalCredential(
  cred: EvalCredential,
): Promise<EvalCredentialInject> {
  const extra =
    cred.kind === 'gateway'
      ? {
          CLAUDE_CODE_USE_GATEWAY: '1',
          ANTHROPIC_BASE_URL: cred.url,
        }
      : {
          CLAUDE_CODE_OAUTH_SCOPES: cred.scopes.join(' '),
          ...(cred.subscriptionType
            ? { CLAUDE_CODE_SUBSCRIPTION_TYPE: cred.subscriptionType }
            : {}),
          ...(cred.rateLimitTier
            ? { CLAUDE_CODE_RATE_LIMIT_TIER: cred.rateLimitTier }
            : {}),
        }
  if (getPlatform() !== 'windows') {
    const fdKey =
      cred.kind === 'gateway'
        ? 'CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR'
        : 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'
    const env: Record<string, string> = {
      [fdKey]: String(EVAL_CREDENTIAL_FD),
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) env[key] = value
    }
    return {
      env,
      viaFd: true,
      cleanup: async () => {},
    }
  }
  const dir = join(tmpdir(), `cc-eval-auth-${process.pid}`)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const snapshot = join(dir, 'snapshot.json')
  const body =
    cred.kind === 'gateway'
      ? { gatewayToken: cred.jwt }
      : {
          accessToken: cred.accessToken,
          scopes: cred.scopes,
          subscriptionType: cred.subscriptionType,
          rateLimitTier: cred.rateLimitTier,
        }
  try {
    await writeFile(snapshot, JSON.stringify(body), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  const env: Record<string, string> = {
    CLAUDE_BG_AUTH_SNAPSHOT_PATH: snapshot,
  }
  if (cred.kind === 'gateway') {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) env[key] = value
    }
  }
  return {
    env,
    viaFd: false,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}),
  }
}
