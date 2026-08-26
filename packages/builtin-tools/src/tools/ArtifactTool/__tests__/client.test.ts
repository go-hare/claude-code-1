import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  isTransientArtifactUploadSocketError,
  SOCKET_CONNECTION_CLOSED_PREFIX,
  uploadArtifact,
} from '../client.js'

const originalFetch = globalThis.fetch

type FetchCall = [string | URL | Request, RequestInit | undefined]

function mockFetch(body: object, status = 200): typeof fetch {
  return mock((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  ) as unknown as typeof fetch
}

function getCalls(fetchMock: typeof fetch): FetchCall[] {
  return (fetchMock as unknown as { mock: { calls: FetchCall[] } }).mock.calls
}

describe('uploadArtifact', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns id/url/expiresAt on successful upload', async () => {
    globalThis.fetch = mockFetch({
      id: 'V1StGXR8_Z5jdHi6B',
      url: 'https://cloud-artifacts.claude-code-best.win/7d/V1StGXR8_Z5jdHi6B.html',
      expiresAt: '2026-06-27T10:00:00.000Z',
    })

    const result = await uploadArtifact({
      html: '<h1>hello</h1>',
      token: 'test-token',
      uploadUrl: 'https://example.test/upload',
    })

    expect(result).toEqual({
      id: 'V1StGXR8_Z5jdHi6B',
      url: 'https://cloud-artifacts.claude-code-best.win/7d/V1StGXR8_Z5jdHi6B.html',
      expiresAt: '2026-06-27T10:00:00.000Z',
    })
  })

  test('sends Connection: close + keepalive:false to avoid Bun dead sockets', async () => {
    const fetchMock = mockFetch({
      id: 'c',
      url: 'https://x/c.html',
      expiresAt: '2026-06-27T00:00:00.000Z',
    })
    globalThis.fetch = fetchMock

    await uploadArtifact({
      html: '<p>x</p>',
      token: 't',
      uploadUrl: 'https://example.test/upload',
    })

    const init = getCalls(fetchMock)[0][1]
    const headers = init?.headers as Record<string, string>
    expect(headers.Connection).toBe('close')
    expect(init?.keepalive).toBe(false)
  })

  test('passes hash as query param when provided', async () => {
    const fetchMock = mockFetch({
      id: 'my-id',
      url: 'https://x/y.html',
      expiresAt: '2026-06-27T00:00:00.000Z',
    })
    globalThis.fetch = fetchMock

    await uploadArtifact({
      html: '<p>x</p>',
      token: 't',
      uploadUrl: 'https://example.test/upload',
      hash: 'my-id',
    })

    expect(getCalls(fetchMock)[0][0].toString()).toContain('hash=my-id')
  })

  test('passes ttl=30 query param when provided', async () => {
    const fetchMock = mockFetch({
      id: 'x',
      url: 'https://x',
      expiresAt: '2026-07-20T00:00:00.000Z',
    })
    globalThis.fetch = fetchMock

    await uploadArtifact({
      html: '<p>x</p>',
      token: 't',
      uploadUrl: 'https://example.test/upload',
      ttl: 30,
    })

    expect(getCalls(fetchMock)[0][0].toString()).toContain('ttl=30')
  })

  test('throws with error code when body contains {error} (Deno Deploy flattens status)', async () => {
    globalThis.fetch = mockFetch({ error: 'payload_too_large' }, 200)

    await expect(
      uploadArtifact({
        html: 'x'.repeat(100),
        token: 't',
        uploadUrl: 'https://example.test/upload',
      }),
    ).rejects.toThrow(/payload_too_large/)
  })

  test('throws on non-JSON body', async () => {
    globalThis.fetch = mock((_u: string | URL | Request) =>
      Promise.resolve(new Response('Internal Server Error', { status: 500 })),
    ) as unknown as typeof fetch

    await expect(
      uploadArtifact({
        html: '<p/>',
        token: 't',
        uploadUrl: 'https://example.test/upload',
      }),
    ).rejects.toThrow()
  })

  test('retries once on Bun socket-closed then succeeds', async () => {
    let calls = 0
    globalThis.fetch = mock((_u: string | URL | Request) => {
      calls++
      if (calls === 1) {
        return Promise.reject(
          new Error(
            `${SOCKET_CONNECTION_CLOSED_PREFIX}. For more information, pass \`verbose: true\` in the second argument to fetch()`,
          ),
        )
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'retry-ok',
            url: 'https://x/retry-ok.html',
            expiresAt: '2026-06-27T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof fetch

    const result = await uploadArtifact({
      html: '<p/>',
      token: 't',
      uploadUrl: 'https://example.test/upload',
    })
    expect(calls).toBe(2)
    expect(result.id).toBe('retry-ok')
  })

  test('does not retry non-transient errors', async () => {
    let calls = 0
    globalThis.fetch = mock((_u: string | URL | Request) => {
      calls++
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch

    await expect(
      uploadArtifact({
        html: '<p/>',
        token: 't',
        uploadUrl: 'https://example.test/upload',
      }),
    ).rejects.toThrow(/unauthorized/)
    expect(calls).toBe(1)
  })

  test('isTransientArtifactUploadSocketError recognizes Bun prefix', () => {
    expect(
      isTransientArtifactUploadSocketError(
        new Error(`${SOCKET_CONNECTION_CLOSED_PREFIX}. verbose…`),
      ),
    ).toBe(true)
    expect(
      isTransientArtifactUploadSocketError(
        new Error('Artifact upload failed: unauthorized'),
      ),
    ).toBe(false)
  })

  test('isTransientArtifactUploadSocketError unwraps Error.cause once', () => {
    const cause = new Error(
      `${SOCKET_CONNECTION_CLOSED_PREFIX}. For more information, pass \`verbose: true\``,
    )
    ;(cause as { code?: string }).code = 'ECONNRESET'
    expect(
      isTransientArtifactUploadSocketError(
        new Error('fetch failed', { cause }),
      ),
    ).toBe(true)
    expect(
      isTransientArtifactUploadSocketError(
        new Error('fetch failed', {
          cause: new Error('Artifact upload failed: unauthorized'),
        }),
      ),
    ).toBe(false)
  })

  test('retries once when socket-closed is wrapped in Error.cause', async () => {
    let calls = 0
    globalThis.fetch = mock((_u: string | URL | Request) => {
      calls++
      if (calls === 1) {
        const cause = new Error(
          `${SOCKET_CONNECTION_CLOSED_PREFIX}. For more information, pass \`verbose: true\``,
        )
        return Promise.reject(new Error('fetch failed', { cause }))
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'cause-retry-ok',
            url: 'https://x/cause-retry-ok.html',
            expiresAt: '2026-06-27T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof fetch

    const result = await uploadArtifact({
      html: '<p/>',
      token: 't',
      uploadUrl: 'https://example.test/upload',
    })
    expect(calls).toBe(2)
    expect(result.id).toBe('cause-retry-ok')
  })
})
