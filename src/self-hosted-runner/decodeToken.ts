/**
 * densable 2.1.224 self-hosted-runner decode-token (Yqv / E2h / w2h / NJl / C2h / A2h / k2h / R2h).
 * 1:1 from SEA `/tmp/official-224/plat/package/claude` — do not invent semantics.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto'
import type { Readable } from 'node:stream'
import { getOauthConfig } from '../constants/oauth.js'
import { getProxyFetchOptions } from '../utils/proxy.js'
import { withTimeout } from '../utils/sleep.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

/** densable `v2h` — max stdin bytes for token */
export const DECODE_TOKEN_STDIN_MAX_BYTES = 16384
/** densable `Vqv` — stdin read timeout ms */
export const DECODE_TOKEN_STDIN_TIMEOUT_MS = 5000
/** densable C2h default skew */
export const DECODE_TOKEN_TIME_SKEW_SEC = 60

/** densable `Gqv` */
const ALG_TO_KTY: Record<string, string> = {
  ES256: 'EC',
  RS256: 'RSA',
}

/** densable `Kqv` */
export const DECODE_TOKEN_HELP = `Usage: claude self-hosted-runner decode-token [token] [options]

Decode a session-ingress JWT (CLAUDE_CODE_SESSION_ACCESS_TOKEN) and print its
claims as JSON to stdout. Strips any sk-ant-cc- / sk-ant-si- prefix
automatically. Pipe to jq to extract a single claim.

Token source (first non-empty wins):
  1. Positional argument
  2. $CLAUDE_CODE_SESSION_ACCESS_TOKEN
  3. Piped stdin

Signature verification against <api-url>/v1/code/.well-known/jwks.json is ON
by default, as is the exp/nbf check (60s skew). Prints "verified (kid=…,
sig+exp)" to stderr on success; exits 1 on verification failure, expiry, or
JWKS fetch error. Does NOT pin iss/aud/token-type — compare those from the
decoded claims if your auth model depends on them.

Options:
  --header           Print the JWT header instead of the claims.
  --no-verify        Skip signature verification and the JWKS fetch. For
                     offline inspection only — do NOT feed the output to an
                     auth decision.
  --no-check-expiry  Skip the exp/nbf check (signature still verified). For
                     forensics ("was this token ever issued by us?").
  --api-url <url>    API base URL for JWKS fetch (default: $ANTHROPIC_BASE_URL
                     or the built-in default).
  --verify           (Deprecated — verification is the default. Kept so older
                     wrapper scripts don't break.)
  --help, -h         Show this help.

Examples:
  # In an --exec-path wrapper: who created this session? Signature is
  # verified by default, so a tampered token exits non-zero here.
  # Use jq -re (not -r) when the claim gates an auth decision — jq -r prints
  # the literal string "null" and exits 0 when the claim is missing.
  creator=$(claude self-hosted-runner decode-token | jq -re .act.email) \\
    || { echo "session JWT: no creator identity or verification failed" >&2; exit 1; }

  # Offline inspection (no network, no auth decision)
  claude self-hosted-runner decode-token --no-verify

  # Decode a different token by piping it (unset the env var first)
  echo "$SOME_TOKEN" | env -u CLAUDE_CODE_SESSION_ACCESS_TOKEN \\
    claude self-hosted-runner decode-token --no-verify
`

export type DecodeTokenArgs = {
  header: boolean
  verify: boolean
  checkExpiry: boolean
  help: boolean
  apiUrl?: string
  token?: string
}

export type JwtParts = {
  headerB64: string
  payloadB64: string
  signatureB64: string
}

/** densable `JWt` — ANTHROPIC_BASE_URL or oauth BASE_API_URL */
export function resolveDecodeTokenApiUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.ANTHROPIC_BASE_URL?.replace(/\/+$/, '')
  if (fromEnv) return fromEnv
  return getOauthConfig().BASE_API_URL
}

/** densable `E2h` */
export function parseDecodeTokenArgs(argv: string[]): DecodeTokenArgs {
  const out: DecodeTokenArgs = {
    header: false,
    verify: true,
    checkExpiry: true,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case '--help':
      case '-h':
        out.help = true
        break
      case '--header':
        out.header = true
        break
      case '--verify':
        out.verify = true
        break
      case '--no-verify':
        out.verify = false
        break
      case '--no-check-expiry':
        out.checkExpiry = false
        break
      case '--api-url': {
        const value = argv[++i]
        if (value === undefined) {
          throw new Error('decode-token: --api-url requires a value')
        }
        out.apiUrl = value
        break
      }
      default:
        if (arg.startsWith('-')) {
          throw new Error(`decode-token: unknown flag ${arg}`)
        }
        if (out.token !== undefined) {
          throw new Error('decode-token: at most one positional token argument')
        }
        out.token = arg
    }
  }
  return out
}

/** densable `w2h` — strip any `sk-ant-<kind>-` prefix then split JWT */
export function splitJwt(token: string): JwtParts {
  const parts = token
    .trim()
    .replace(/^sk-ant-[a-z0-9]+-/i, '')
    .split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error(
      'decode-token: not a JWT — expected 3 dot-separated base64url segments ' +
        `(after stripping any sk-ant- prefix), got ${parts.length}`,
    )
  }
  return {
    headerB64: parts[0],
    payloadB64: parts[1],
    signatureB64: parts[2],
  }
}

/** densable `NJl` */
export function decodeSegment(
  b64: string,
  label: string,
): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(b64)) {
    throw new Error(
      `decode-token: ${label} is not valid base64url (unexpected characters)`,
    )
  }
  const text = Buffer.from(b64, 'base64url').toString('utf8')
  let parsed: unknown
  try {
    parsed = jsonParse(text)
  } catch (err) {
    throw new Error(`decode-token: ${label} is not valid JSON: ${err}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`decode-token: ${label} is not a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/** densable `C2h` — exp required; nbf optional; 60s skew default */
export function checkTokenTime(
  payload: Record<string, unknown>,
  nowSec: number = Math.floor(Date.now() / 1000),
  skewSec: number = DECODE_TOKEN_TIME_SKEW_SEC,
): void {
  const exp = payload.exp
  const nbf = payload.nbf
  if (typeof exp !== 'number') {
    throw new Error('decode-token: token has no numeric `exp` claim')
  }
  if (nowSec > exp + skewSec) {
    throw new Error(
      `decode-token: token EXPIRED at ${new Date(exp * 1000).toISOString()} (${Math.round(nowSec - exp)}s ago)`,
    )
  }
  if (typeof nbf === 'number' && nowSec + skewSec < nbf) {
    throw new Error(
      `decode-token: token not valid until ${new Date(nbf * 1000).toISOString()}`,
    )
  }
}

export type VerifyAgainstJwksParams = {
  headerB64: string
  payloadB64: string
  signatureB64: string
  header: Record<string, unknown>
  payload: Record<string, unknown>
  jwksUrl: string
  fetchFn?: typeof fetch
  checkExpiry?: boolean
}

/** densable `A2h` */
export async function verifyAgainstJwks(
  params: VerifyAgainstJwksParams,
): Promise<{ kid: string }> {
  const alg = params.header.alg
  const kid = params.header.kid
  if (typeof alg !== 'string' || typeof kid !== 'string') {
    throw new Error(
      'decode-token: JWT header is missing `alg` or `kid` — cannot select a JWKS key',
    )
  }
  const kty = ALG_TO_KTY[alg]
  if (!kty) {
    throw new Error(
      `decode-token: unsupported alg=${alg} — only ES256 and RS256 are supported`,
    )
  }

  const fetchFn = params.fetchFn ?? fetch
  let response: Response
  try {
    response = await fetchFn(params.jwksUrl, {
      ...getProxyFetchOptions({ forAnthropicAPI: true }),
      signal: AbortSignal.timeout(30_000),
    } as RequestInit)
  } catch (err) {
    throw new Error(
      `decode-token: failed to fetch JWKS from ${params.jwksUrl}: ${err}`,
    )
  }
  if (!response.ok) {
    throw new Error(
      `decode-token: JWKS fetch returned ${response.status} ${response.statusText} for ${params.jwksUrl}`,
    )
  }

  const body = (await response.json()) as {
    keys?: Array<Record<string, unknown>>
  }
  const jwk = body.keys?.find(k => k.kid === kid)
  if (!jwk) {
    throw new Error(
      `decode-token: no JWKS key with kid=${kid} at ${params.jwksUrl} — ` +
        'token may be signed by a different environment (try --api-url).',
    )
  }
  if (jwk.kty !== kty) {
    throw new Error(
      `decode-token: JWKS key kid=${kid} has kty=${jwk.kty} but alg=${alg} needs kty=${kty}`,
    )
  }

  const keyObject = createPublicKey({
    key: jwk as JsonWebKey,
    format: 'jwk',
  })
  const key =
    alg === 'ES256'
      ? { key: keyObject, dsaEncoding: 'ieee-p1363' as const }
      : { key: keyObject }

  const data = Buffer.from(`${params.headerB64}.${params.payloadB64}`, 'utf8')
  const signature = Buffer.from(params.signatureB64, 'base64url')
  if (!cryptoVerify('sha256', data, key, signature)) {
    throw new Error('decode-token: signature verification FAILED')
  }
  if (params.checkExpiry !== false) {
    checkTokenTime(params.payload)
  }
  return { kid }
}

/** densable `R2h` */
export async function readTokenStdin(
  stdin: Readable = process.stdin,
): Promise<string> {
  // densable: if (e.isTTY) return ""
  const maybeTty = stdin as NodeJS.ReadStream
  if (typeof maybeTty.isTTY === 'boolean' && maybeTty.isTTY) {
    return ''
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stdin) {
    const buf = Buffer.from(chunk as Buffer | string)
    total += buf.length
    if (total > DECODE_TOKEN_STDIN_MAX_BYTES) {
      throw new Error(
        `decode-token: stdin exceeds ${DECODE_TOKEN_STDIN_MAX_BYTES / 1024} KiB; session-ingress JWTs are ~1 KB. Pass the token as an argument or set $CLAUDE_CODE_SESSION_ACCESS_TOKEN.`,
      )
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** densable `k2h` — arg > env > stdin */
export async function resolveToken(
  argToken: string | undefined,
  env: NodeJS.ProcessEnv,
  stdin: Readable = process.stdin,
  stdinTimeoutMs: number = DECODE_TOKEN_STDIN_TIMEOUT_MS,
): Promise<string> {
  if (argToken?.trim()) return argToken.trim()
  const fromEnv = env.CLAUDE_CODE_SESSION_ACCESS_TOKEN?.trim()
  if (fromEnv) return fromEnv
  const fromStdin = (
    await withTimeout(
      readTokenStdin(stdin),
      stdinTimeoutMs,
      `decode-token: reading token from stdin timed out after ${stdinTimeoutMs}ms`,
    )
  ).trim()
  if (fromStdin) return fromStdin
  throw new Error(
    'decode-token: no token supplied. Pass it as an argument, pipe it on stdin, or set $CLAUDE_CODE_SESSION_ACCESS_TOKEN.',
  )
}

/**
 * densable `Yqv` / `selfHostedRunnerDecodeTokenMain`
 * Writes claims (or header) JSON to stdout; verified line to stderr when verifying.
 */
export async function selfHostedRunnerDecodeTokenMain(
  argv: string[],
): Promise<void> {
  let parsed: DecodeTokenArgs
  try {
    parsed = parseDecodeTokenArgs(argv)
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
  if (parsed.help) {
    process.stdout.write(DECODE_TOKEN_HELP)
    process.exit(0)
  }
  try {
    const token = await resolveToken(parsed.token, process.env)
    const { headerB64, payloadB64, signatureB64 } = splitJwt(token)
    const header = decodeSegment(headerB64, 'header')
    const payload = decodeSegment(payloadB64, 'payload')
    if (parsed.verify) {
      const base = (parsed.apiUrl ?? resolveDecodeTokenApiUrl()).replace(
        /\/+$/,
        '',
      )
      const jwksUrl = `${base}/v1/code/.well-known/jwks.json`
      const { kid } = await verifyAgainstJwks({
        headerB64,
        payloadB64,
        signatureB64,
        header,
        payload,
        jwksUrl,
        fetchFn: fetch,
        checkExpiry: parsed.checkExpiry,
      })
      const mode = parsed.checkExpiry ? 'sig+exp' : 'sig only, exp SKIPPED'
      process.stderr.write(`verified (kid=${kid}, ${mode})\n`)
    }
    const out = parsed.header ? header : payload
    process.stdout.write(`${jsonStringify(out, null, 2)}\n`)
    process.exit(0)
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  }
}
