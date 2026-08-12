/**
 * densable 2.1.228 #14 — withRetry GCP auth hard cap (runtime).
 *
 * Source-shape tests live in vertexAuthFailFast.228.test.ts; this file
 * exercises the actual loop: 401 under USE_VERTEX exhausts at
 * MAX_CLOUD_AUTH_RETRIES and throws CannotRetryError (not full maxRetries).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import type Anthropic from '@anthropic-ai/sdk'

const sleepMock = mock(async (..._args: unknown[]) => {})

/**
 * `mock.module` is process-global last-write-wins and replaces the *entire*
 * module. withRetry only needs `sleep`, but the import graph (e.g.
 * analytics/growthbook) also imports `withTimeout` from the same module —
 * omitting it breaks this file and pollutes later tests in the same process.
 */
function withTimeoutPassthrough<T>(
  promise: Promise<T>,
  _ms: number,
  _message: string,
): Promise<T> {
  return promise
}

// Hoist before withRetry binds sleep — use both alias forms Bun may resolve.
mock.module('src/utils/sleep.js', () => ({
  sleep: (...args: unknown[]) => sleepMock(...args),
  withTimeout: withTimeoutPassthrough,
}))
mock.module('src/utils/sleep.ts', () => ({
  sleep: (...args: unknown[]) => sleepMock(...args),
  withTimeout: withTimeoutPassthrough,
}))

const { CannotRetryError, MAX_CLOUD_AUTH_RETRIES, withRetry } = await import(
  '../withRetry.js'
)

const providerEnvKeys = [
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_UNATTENDED_RETRY',
] as const

const saved = new Map<string, string | undefined>()
let savedApiKey: string | undefined

function pinVertex(): void {
  for (const k of providerEnvKeys) {
    saved.set(k, process.env[k])
    delete process.env[k]
  }
  process.env.CLAUDE_CODE_USE_VERTEX = '1'
  savedApiKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY =
    process.env.ANTHROPIC_API_KEY || 'test-key-vertex-retry-cap'
}

function restore(): void {
  for (const k of providerEnvKeys) {
    const v = saved.get(k)
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  saved.clear()
  if (savedApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = savedApiKey
  savedApiKey = undefined
}

beforeEach(() => {
  sleepMock.mockClear()
  sleepMock.mockImplementation(async () => {})
  pinVertex()
})

afterEach(() => {
  restore()
})

async function drainWithRetry(
  operation: (client: Anthropic, attempt: number) => Promise<unknown>,
): Promise<{ error: unknown; opCalls: number }> {
  let opCalls = 0
  const gen = withRetry(
    async () => ({}) as Anthropic,
    async (client, attempt) => {
      opCalls++
      return operation(client, attempt)
    },
    {
      model: 'claude-sonnet-4-6',
      thinkingConfig: { type: 'disabled' },
      // large budget so auth cap (not maxRetries) is the limiting factor
      maxRetries: 10,
      querySource: 'repl_main_thread',
    },
  )
  try {
    // exhaust generator
    let step = await gen.next()
    while (!step.done) {
      step = await gen.next()
    }
    return { error: null, opCalls }
  } catch (error) {
    return { error, opCalls }
  }
}

describe('densable 2.1.228 #14 withRetry Vertex auth cap (runtime)', () => {
  test('repeated Vertex 401 throws CannotRetryError at MAX_CLOUD_AUTH_RETRIES', async () => {
    expect(MAX_CLOUD_AUTH_RETRIES).toBe(2)
    const err401 = new APIError(
      401,
      { message: 'expired' },
      'expired',
      new Headers(),
    )
    const { error, opCalls } = await drainWithRetry(async () => {
      throw err401
    })
    expect(error).toBeInstanceOf(CannotRetryError)
    expect((error as InstanceType<typeof CannotRetryError>).originalError).toBe(
      err401,
    )
    // attempts: fail, count 0→1; fail, count 1→2; fail, count 2≥2 throw
    // so operation runs 3 times (initial + 2 auth retries)
    expect(opCalls).toBe(MAX_CLOUD_AUTH_RETRIES + 1)
    // must NOT burn the full maxRetries budget (10+1)
    expect(opCalls).toBeLessThan(10)
  })

  test('Vertex 403 is NOT ugi-capped (densable ugi only status===401)', async () => {
    // densable ugi: only 401 (and google-auth-library) — 403 is YKd for *copy*
    // but does not enter the cloud-auth retry counter. 403 is also generally
    // non-retriable, so we throw on first fail (opCalls=1), not after auth cap 3.
    const err403 = new APIError(
      403,
      { message: 'permission denied' },
      'permission denied',
      new Headers(),
    )
    const { error, opCalls } = await drainWithRetry(async () => {
      throw err403
    })
    expect(error).toBeInstanceOf(CannotRetryError)
    expect((error as InstanceType<typeof CannotRetryError>).originalError).toBe(
      err403,
    )
    // Must NOT look like the 401 auth-cap path (MAX+1 attempts)
    expect(opCalls).toBe(1)
  })

  test('non-auth API error still uses normal retry path (not gcp cap)', async () => {
    // 500 is retriable via shouldRetry; without host auth / vertex auth path
    // it will keep going until maxRetries — use maxRetries:1 to bound.
    // Vertex 500 is NOT isVertexAuthError (only 401 / google-auth-library).
    const err500 = new APIError(500, { message: 'boom' }, 'boom', new Headers())
    let opCalls = 0
    const gen = withRetry(
      async () => ({}) as Anthropic,
      async () => {
        opCalls++
        throw err500
      },
      {
        model: 'claude-sonnet-4-6',
        thinkingConfig: { type: 'disabled' },
        maxRetries: 1,
        querySource: 'repl_main_thread',
      },
    )
    let caught: unknown
    try {
      let step = await gen.next()
      while (!step.done) step = await gen.next()
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(CannotRetryError)
    // maxRetries=1 → attempts 1 and 2 then throw (or similar) — not auth cap of 3
    expect(opCalls).toBeGreaterThanOrEqual(2)
  })
})
