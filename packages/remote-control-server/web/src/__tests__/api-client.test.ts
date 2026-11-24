import { describe, test, expect, beforeEach } from 'bun:test'

// In-memory localStorage mock
let store: Record<string, string> = {}

beforeEach(() => {
  store = {}
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      store = {}
    },
    get length() {
      return Object.keys(store).length
    },
    key: () => null,
  }
})

// Mock fetch
const fetchMock = {
  lastUrl: '',
  lastOpts: {} as RequestInit,
  response: { ok: true, status: 200, statusText: 'OK' },
  responseData: {} as unknown,
  rawResponseText: null as string | null,
}

beforeEach(() => {
  fetchMock.lastUrl = ''
  fetchMock.lastOpts = {}
  fetchMock.response = { ok: true, status: 200, statusText: 'OK' }
  fetchMock.responseData = {}
  fetchMock.rawResponseText = null
  client.setActiveApiToken(null)
})

;(globalThis as any).fetch = async (url: string, opts: RequestInit) => {
  fetchMock.lastUrl = url
  fetchMock.lastOpts = opts
  const textPayload =
    fetchMock.rawResponseText !== null
      ? fetchMock.rawResponseText
      : JSON.stringify(fetchMock.responseData)
  return {
    ok: fetchMock.response.ok,
    status: fetchMock.response.status,
    statusText: fetchMock.response.statusText,
    text: async () => textPayload,
    json: async () => JSON.parse(textPayload),
  } as Response
}

const { getUuid, setUuid } = await import('../api/client')
const client = await import('../api/client')
const relayClient = await import('../acp/relay-client')

// =============================================================================
// getUuid() & setUuid()
// =============================================================================

describe('getUuid', () => {
  test('returns existing UUID from localStorage', () => {
    store['rcs_uuid'] = 'existing-uuid'
    expect(getUuid()).toBe('existing-uuid')
  })

  test('generates and stores new UUID when none exists', () => {
    const uuid = getUuid()
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(store['rcs_uuid']).toBe(uuid)
  })

  test('heals corrupted __default__ sentinel stored in rcs_uuid', () => {
    store['rcs_uuid'] = '__default__'
    const uuid = getUuid()
    expect(uuid).not.toBe('__default__')
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(store['rcs_uuid']).toBe(uuid)
  })

  test('heals corrupted tk_ token id stored in rcs_uuid', () => {
    store['rcs_uuid'] = 'tk_abc123_xyz'
    const uuid = getUuid()
    expect(uuid.startsWith('tk_')).toBe(false)
    expect(store['rcs_uuid']).toBe(uuid)
  })

  test('returns same UUID on subsequent calls', () => {
    const a = getUuid()
    const b = getUuid()
    expect(a).toBe(b)
  })
})

describe('setUuid', () => {
  test('writes valid UUID to localStorage', () => {
    setUuid('custom-uuid-999')
    expect(store['rcs_uuid']).toBe('custom-uuid-999')
  })

  test('ignores corrupted sentinel or tk_ values', () => {
    store['rcs_uuid'] = 'good-uuid'
    setUuid('__default__')
    setUuid('tk_bad_id')
    expect(store['rcs_uuid']).toBe('good-uuid')
  })

  test('getUuid returns the set UUID', () => {
    setUuid('my-uuid')
    expect(getUuid()).toBe('my-uuid')
  })
})

// =============================================================================
// api() — X-UUID header & error parsing
// =============================================================================

describe('api functions', () => {
  test('GET request sends X-UUID header instead of query string uuid', async () => {
    store['rcs_uuid'] = 'test-uuid'
    fetchMock.responseData = []
    await client.apiFetchSessions()
    expect(fetchMock.lastUrl).toBe('/web/sessions')
    expect(fetchMock.lastUrl).not.toContain('uuid=')
    expect(fetchMock.lastOpts.method).toBe('GET')
    expect(fetchMock.lastOpts.headers).toEqual({
      'Content-Type': 'application/json',
      'X-UUID': 'test-uuid',
    })
  })

  test('POST request includes JSON body and X-UUID header', async () => {
    store['rcs_uuid'] = 'test-uuid'
    fetchMock.responseData = {}
    await client.apiBind('sess-1')
    expect(fetchMock.lastUrl).toBe('/web/bind')
    expect(fetchMock.lastOpts.method).toBe('POST')
    expect(fetchMock.lastOpts.body).toBe(
      JSON.stringify({ sessionId: 'sess-1' }),
    )
    expect(fetchMock.lastOpts.headers).toEqual({
      'Content-Type': 'application/json',
      'X-UUID': 'test-uuid',
    })
  })

  test('active API token is sent only in Authorization header alongside X-UUID', async () => {
    store['rcs_uuid'] = 'browser-uuid'
    fetchMock.responseData = []
    client.setActiveApiToken('secret-token')

    await client.apiFetchSessions()

    expect(fetchMock.lastUrl).toBe('/web/sessions')
    expect(fetchMock.lastUrl).not.toContain('secret-token')
    expect(fetchMock.lastUrl).not.toContain('browser-uuid')
    expect(fetchMock.lastOpts.headers).toEqual({
      'Content-Type': 'application/json',
      'X-UUID': 'browser-uuid',
      Authorization: 'Bearer secret-token',
    })
  })

  test('throws error message on structured object error response', async () => {
    store['rcs_uuid'] = 'test-uuid'
    fetchMock.response = { ok: false, status: 401, statusText: 'Unauthorized' }
    fetchMock.responseData = {
      error: { type: 'auth', message: 'Invalid UUID' },
    }
    await expect(client.apiFetchSessions()).rejects.toThrow('Invalid UUID')
  })

  test('throws error message on legacy string error response', async () => {
    store['rcs_uuid'] = 'test-uuid'
    fetchMock.response = { ok: false, status: 400, statusText: 'Bad Request' }
    fetchMock.responseData = { error: 'sessionId and uuid are required' }
    await expect(client.apiFetchSessions()).rejects.toThrow(
      'sessionId and uuid are required',
    )
  })

  test('throws clean error on non-JSON HTML/text error response', async () => {
    store['rcs_uuid'] = 'test-uuid'
    fetchMock.response = { ok: false, status: 502, statusText: 'Bad Gateway' }
    fetchMock.rawResponseText = '<html>502 Bad Gateway</html>'
    await expect(client.apiFetchSessions()).rejects.toThrow(
      '<html>502 Bad Gateway</html>',
    )
  })

  test('throws with statusText when error body is empty', async () => {
    store['rcs_uuid'] = 'test-uuid'
    fetchMock.response = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }
    fetchMock.rawResponseText = ''
    await expect(client.apiFetchSessions()).rejects.toThrow(
      'Internal Server Error',
    )
  })
})

describe('ACP relay client', () => {
  test('builds relay URLs without UUID or token query params', () => {
    ;(globalThis as any).window = {
      location: {
        protocol: 'https:',
        host: 'rcs.example.test',
      },
    }

    expect(relayClient.buildRelayUrl('agent_123')).toBe(
      'wss://rcs.example.test/acp/relay/agent_123',
    )
  })
})
