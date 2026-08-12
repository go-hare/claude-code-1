/**
 * densable 2.1.224 #1 — self-hosted-runner decode-token (Yqv/E2h/w2h/NJl/C2h).
 */
import { describe, expect, test } from 'bun:test'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkTokenTime,
  decodeSegment,
  DECODE_TOKEN_HELP,
  DECODE_TOKEN_STDIN_MAX_BYTES,
  DECODE_TOKEN_STDIN_TIMEOUT_MS,
  DECODE_TOKEN_TIME_SKEW_SEC,
  parseDecodeTokenArgs,
  resolveDecodeTokenApiUrl,
  splitJwt,
  verifyAgainstJwks,
} from '../decodeToken.js'

const decodeSrc = readFileSync(
  join(import.meta.dir, '../decodeToken.ts'),
  'utf8',
)
const mainSrc = readFileSync(join(import.meta.dir, '../main.ts'), 'utf8')
const cliSrc = readFileSync(
  join(import.meta.dir, '../../entrypoints/cli.tsx'),
  'utf8',
)

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')
}

describe('densable 2.1.224 #1 decode-token constants + pure helpers', () => {
  test('constants match densable v2h/Vqv/C2h skew', () => {
    expect(DECODE_TOKEN_STDIN_MAX_BYTES).toBe(16384)
    expect(DECODE_TOKEN_STDIN_TIMEOUT_MS).toBe(5000)
    expect(DECODE_TOKEN_TIME_SKEW_SEC).toBe(60)
  })

  test('help mentions JWKS path and token sources', () => {
    expect(DECODE_TOKEN_HELP).toContain(
      'Usage: claude self-hosted-runner decode-token',
    )
    expect(DECODE_TOKEN_HELP).toContain('/v1/code/.well-known/jwks.json')
    expect(DECODE_TOKEN_HELP).toContain('CLAUDE_CODE_SESSION_ACCESS_TOKEN')
    expect(DECODE_TOKEN_HELP).toContain('--no-verify')
    expect(DECODE_TOKEN_HELP).toContain('--no-check-expiry')
  })

  test('parseDecodeTokenArgs: defaults + flags (E2h)', () => {
    expect(parseDecodeTokenArgs([])).toEqual({
      header: false,
      verify: true,
      checkExpiry: true,
      help: false,
    })
    expect(parseDecodeTokenArgs(['--no-verify', 'tok'])).toEqual({
      header: false,
      verify: false,
      checkExpiry: true,
      help: false,
      token: 'tok',
    })
    expect(
      parseDecodeTokenArgs([
        '--header',
        '--no-check-expiry',
        '--api-url',
        'https://example.test',
        '--verify',
      ]),
    ).toEqual({
      header: true,
      verify: true,
      checkExpiry: false,
      help: false,
      apiUrl: 'https://example.test',
    })
  })

  test('parseDecodeTokenArgs errors', () => {
    expect(() => parseDecodeTokenArgs(['--api-url'])).toThrow(
      'decode-token: --api-url requires a value',
    )
    expect(() => parseDecodeTokenArgs(['--bogus'])).toThrow(
      'decode-token: unknown flag --bogus',
    )
    expect(() => parseDecodeTokenArgs(['a', 'b'])).toThrow(
      'decode-token: at most one positional token argument',
    )
  })

  test('splitJwt strips sk-ant-* prefix (w2h)', () => {
    const header = b64urlJson({ alg: 'ES256', kid: 'k1' })
    const payload = b64urlJson({ exp: 9999999999 })
    const sig = 'sigpart'
    const raw = `${header}.${payload}.${sig}`
    expect(splitJwt(raw)).toEqual({
      headerB64: header,
      payloadB64: payload,
      signatureB64: sig,
    })
    expect(splitJwt(`sk-ant-si-${raw}`)).toEqual({
      headerB64: header,
      payloadB64: payload,
      signatureB64: sig,
    })
    expect(splitJwt(`sk-ant-cc-${raw}`)).toEqual({
      headerB64: header,
      payloadB64: payload,
      signatureB64: sig,
    })
    expect(() => splitJwt('not.a.jwt.extra')).toThrow('not a JWT')
    expect(() => splitJwt('only.two')).toThrow('got 2')
  })

  test('decodeSegment validates base64url + object (NJl)', () => {
    const ok = b64urlJson({ alg: 'ES256' })
    expect(decodeSegment(ok, 'header')).toEqual({ alg: 'ES256' })
    expect(() => decodeSegment('!!!', 'header')).toThrow('not valid base64url')
    const arr = Buffer.from('[1]', 'utf8').toString('base64url')
    expect(() => decodeSegment(arr, 'payload')).toThrow('not a JSON object')
  })

  test('checkTokenTime exp/nbf with 60s skew (C2h)', () => {
    const now = 1_700_000_000
    checkTokenTime({ exp: now + 10 }, now)
    checkTokenTime({ exp: now - 30 }, now) // within skew
    expect(() => checkTokenTime({ exp: now - 120 }, now)).toThrow('EXPIRED')
    expect(() => checkTokenTime({}, now)).toThrow('no numeric `exp`')
    checkTokenTime({ exp: now + 1000, nbf: now - 10 }, now)
    expect(() =>
      checkTokenTime({ exp: now + 1000, nbf: now + 120 }, now),
    ).toThrow('not valid until')
  })

  test('resolveDecodeTokenApiUrl prefers ANTHROPIC_BASE_URL (JWt)', () => {
    expect(
      resolveDecodeTokenApiUrl({
        ANTHROPIC_BASE_URL: 'https://example.test/v1///',
      }),
    ).toBe('https://example.test/v1')
  })
})

describe('densable 2.1.224 #1 decode-token verifyAgainstJwks (A2h)', () => {
  test('ES256 verify success + wrong kid + bad sig', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    })
    const kid = 'test-kid-es256'
    const jwk = {
      ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
      kid,
      alg: 'ES256',
      use: 'sig',
    }

    const header = { alg: 'ES256', kid }
    const payload = {
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'session',
    }
    const headerB64 = b64urlJson(header)
    const payloadB64 = b64urlJson(payload)
    const data = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8')
    const sig = sign('sha256', data, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    })
    const signatureB64 = Buffer.from(sig).toString('base64url')

    const jwksUrl = 'https://example.test/v1/code/.well-known/jwks.json'
    const fetchOk = (async () =>
      new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
      })) as unknown as typeof fetch

    const ok = await verifyAgainstJwks({
      headerB64,
      payloadB64,
      signatureB64,
      header,
      payload,
      jwksUrl,
      fetchFn: fetchOk,
      checkExpiry: true,
    })
    expect(ok.kid).toBe(kid)

    await expect(
      verifyAgainstJwks({
        headerB64,
        payloadB64,
        signatureB64,
        header: { alg: 'ES256', kid: 'other' },
        payload,
        jwksUrl,
        fetchFn: fetchOk,
      }),
    ).rejects.toThrow('no JWKS key with kid=other')

    // Flip a byte so crypto.verify fails deterministically (base64url last-char
    // swaps can decode to the same key material for some paddings).
    const flipped = Buffer.from(sig)
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff
    const badSig = flipped.toString('base64url')
    await expect(
      verifyAgainstJwks({
        headerB64,
        payloadB64,
        signatureB64: badSig,
        header,
        payload,
        jwksUrl,
        fetchFn: fetchOk,
      }),
    ).rejects.toThrow('signature verification FAILED')
  })
})

describe('densable 2.1.224 #1 source gold (CLI + exports)', () => {
  test('decodeToken exports densable symbols', () => {
    expect(decodeSrc).toContain('export function parseDecodeTokenArgs')
    expect(decodeSrc).toContain('export function splitJwt')
    expect(decodeSrc).toContain('export function decodeSegment')
    expect(decodeSrc).toContain('export function checkTokenTime')
    expect(decodeSrc).toContain('export async function verifyAgainstJwks')
    expect(decodeSrc).toContain(
      'export async function selfHostedRunnerDecodeTokenMain',
    )
    expect(decodeSrc).toContain('sk-ant-[a-z0-9]+-')
    expect(decodeSrc).toContain('ES256')
    expect(decodeSrc).toContain('RS256')
    expect(decodeSrc).toContain('ieee-p1363')
  })

  test('cli.tsx fast-path self-hosted-runner before tmux', () => {
    expect(cliSrc).toContain("args[0] === 'self-hosted-runner'")
    expect(cliSrc).toContain("profileCheckpoint('cli_self_hosted_runner_path')")
    expect(cliSrc).toContain('selfHostedRunnerCliMain')
    const shr = cliSrc.indexOf("args[0] === 'self-hosted-runner'")
    const tmux = cliSrc.indexOf('cli_tmux_worktree_fast_path')
    expect(shr).toBeGreaterThan(0)
    expect(tmux).toBeGreaterThan(shr)
  })

  test('main routes all densable subcommands', () => {
    expect(mainSrc).toContain("sub === 'decode-token'")
    expect(mainSrc).toContain('selfHostedRunnerDecodeTokenMain')
    expect(mainSrc).toContain("sub === 'code-sign'")
    expect(mainSrc).toContain("sub === 'orchestrator'")
    expect(mainSrc).toContain('selfHostedRunnerOrchestratorMain')
    expect(mainSrc).toContain("sub === 'setup'")
    expect(mainSrc).toContain('selfHostedRunnerSetupMain')
    expect(mainSrc).toContain("sub === 'doctor'")
    expect(mainSrc).toContain('selfHostedRunnerDoctorMain')
    expect(mainSrc).toContain('selfHostedRunnerMain')
  })
})
