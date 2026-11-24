import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import type { ThreadEntry, PendingPermission } from '../lib/types'
import type { SessionEvent, SessionTaskItem } from '../types'

// ---- Test Doubles for localStorage, fetch, EventSource, WebSocket ----

let lsStore: Record<string, string> = {}

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  closed = false
  private listeners = new Map<string, Set<(ev: any) => void>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (ev: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  emitMessage(data: unknown) {
    const handlers = this.listeners.get('message')
    if (!handlers) return
    const event = { data: JSON.stringify(data) }
    for (const h of handlers) h(event)
  }

  emitError() {
    const handlers = this.listeners.get('error')
    if (!handlers) return
    for (const h of handlers) h({})
  }

  close() {
    this.closed = true
  }
}

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static instances: MockWebSocket[] = []
  readyState = 1
  url: string
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }

  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

type FetchHandler = (
  url: string,
  opts?: RequestInit,
) => Promise<{ ok: boolean; status: number; statusText: string; data: unknown }>

let fetchHandler: FetchHandler = async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  data: {},
})

const origLocalStorage = (globalThis as any).localStorage
const origEventSource = (globalThis as any).EventSource
const origWebSocket = (globalThis as any).WebSocket
const origFetch = (globalThis as any).fetch

beforeEach(() => {
  lsStore = {}
  MockEventSource.instances = []
  MockWebSocket.instances = []
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => lsStore[k] ?? null,
    setItem: (k: string, v: string) => {
      lsStore[k] = v
    },
    removeItem: (k: string) => {
      delete lsStore[k]
    },
    clear: () => {
      lsStore = {}
    },
    get length() {
      return Object.keys(lsStore).length
    },
    key: () => null,
  }
  ;(globalThis as any).EventSource = MockEventSource
  ;(globalThis as any).WebSocket = MockWebSocket
  ;(globalThis as any).fetch = async (url: string, opts?: RequestInit) => {
    const res = await fetchHandler(url, opts)
    const text = JSON.stringify(res.data)
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      text: async () => text,
      json: async () => res.data,
    } as Response
  }
})

afterEach(() => {
  ;(globalThis as any).localStorage = origLocalStorage
  ;(globalThis as any).EventSource = origEventSource
  ;(globalThis as any).WebSocket = origWebSocket
  ;(globalThis as any).fetch = origFetch
})

const {
  ACTIVE_TOKEN_KEY,
  DEFAULT_TOKEN_ID,
  ensureDefault,
  loadActiveTokenId,
  resolveActiveApiToken,
} = await import('../hooks/useTokens')
const { getUuid, setUuid } = await import('../api/client')
const { RCSChatAdapter } = await import('../lib/rcs-chat-adapter')
const { connectSSE, disconnectSSE } = await import('../api/sse')
const { sseBus } = await import('../lib/rcs-transport')
const { buildAskUserAnswers, toggleMultiSelectAnswer } = await import(
  '../components/PermissionViews'
)
const { ACPClient, DisconnectRequestedError } = await import('../acp/client')
const { createRouteController } = await import('../App')
const { sanitizeImageMimeType, openImageSafely } = await import(
  '../../components/chat/MessageBubble'
)
const {
  ensureInitialAcpSession,
  clearInitialAcpSession,
  applyPermissionModeChange,
} = await import('../../components/ChatInterface')

describe('P0-D7-1: useTokens storage isolation', () => {
  test('ACTIVE_TOKEN_KEY is separate from rcs_uuid and never corrupts rcs_uuid', () => {
    expect(ACTIVE_TOKEN_KEY).toBe('rcs_active_token_id')
    expect(ACTIVE_TOKEN_KEY).not.toBe('rcs_uuid')

    lsStore['rcs_uuid'] = 'real-user-uuid-1234'
    lsStore[ACTIVE_TOKEN_KEY] = 'tk_custom_1'

    const tokens = ensureDefault([
      { id: 'tk_custom_1', token: 'api-key-1', label: 'Work' },
    ])
    expect(tokens[0]).toEqual({
      id: DEFAULT_TOKEN_ID,
      token: 'real-user-uuid-1234',
      label: 'Default',
    })
    expect(loadActiveTokenId(tokens)).toBe('tk_custom_1')
    expect(lsStore['rcs_uuid']).toBe('real-user-uuid-1234')
  })

  test('ensureDefault heals previously corrupted __default__ in rcs_uuid', () => {
    lsStore['rcs_uuid'] = '__default__'
    const tokens = ensureDefault([
      { id: DEFAULT_TOKEN_ID, token: '__default__', label: 'Default' },
    ])
    expect(tokens[0]!.token).not.toBe('__default__')
    expect(lsStore['rcs_uuid']).toBe(tokens[0]!.token)
  })
})

describe('P0-D7-3, P0-D7-4, P0-D7-6, P1-D7-9, P1-D7-16, P2-D7-31: RCSChatAdapter', () => {
  test('cancels init() cleanly when disconnect() is called mid-flight without leaking EventSource', async () => {
    let resolveBind!: () => void
    fetchHandler = async url => {
      if (url === '/web/bind') {
        await new Promise<void>(r => {
          resolveBind = r
        })
      }
      return { ok: true, status: 200, statusText: 'OK', data: { events: [] } }
    }

    let entries: ThreadEntry[] = []
    const adapter = new RCSChatAdapter('sess_abort', action => {
      entries = typeof action === 'function' ? action(entries) : action
    })

    const initPromise = adapter.init()
    adapter.disconnect()
    resolveBind()
    await initPromise

    expect(adapter.isDisposed()).toBe(true)
    expect(MockEventSource.instances).toHaveLength(0)
  })

  test('tracks lastSeqNum from history, passes from_sequence_num, deduplicates SSE, and handles restart seq reset', async () => {
    const historyEvents: SessionEvent[] = [
      {
        id: 'ev-1',
        type: 'user',
        direction: 'outbound',
        seqNum: 1,
        payload: { uuid: 'u-1', content: 'Hello from outbound' },
      },
      {
        id: 'ev-2',
        type: 'user',
        direction: 'inbound',
        seqNum: 2,
        payload: { uuid: 'u-1', content: 'Hello from outbound' },
      },
      {
        id: 'ev-3',
        type: 'assistant',
        direction: 'inbound',
        seqNum: 3,
        payload: {
          content: 'Running tool',
          message: {
            content: [
              { type: 'text', text: 'Running tool' },
              {
                type: 'tool_use',
                id: 'tu_1',
                name: 'Bash',
                input: { command: 'ls' },
              },
            ],
          },
        },
      },
      {
        id: 'ev-4',
        type: 'control_request',
        direction: 'inbound',
        seqNum: 4,
        payload: {
          request_id: 'perm_1',
          request: {
            subtype: 'can_use_tool',
            tool_name: 'Bash',
            tool_use_id: 'tu_1',
            input: { command: 'ls' },
          },
        },
      },
      {
        id: 'ev-5',
        type: 'task_state',
        direction: 'inbound',
        seqNum: 5,
        payload: {
          tasks: [{ id: 't1', subject: 'Fix bug', status: 'in_progress' }],
        },
      },
    ]

    fetchHandler = async url => {
      if (url.endsWith('/history')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          data: { events: historyEvents },
        }
      }
      return { ok: true, status: 200, statusText: 'OK', data: { ok: true } }
    }

    let entries: ThreadEntry[] = []
    const permissions: PendingPermission[] = []
    let capturedTasks: SessionTaskItem[] = []
    let clearedCount = 0
    let turnCompletedCount = 0

    const adapter = new RCSChatAdapter(
      'sess_hist',
      action => {
        entries = typeof action === 'function' ? action(entries) : action
      },
      {
        onPermissionRequest: p => permissions.push(p),
        onTasksChange: t => {
          capturedTasks = t
        },
        onConversationCleared: () => {
          clearedCount++
        },
        onTurnComplete: () => {
          turnCompletedCount++
        },
      },
    )

    await adapter.init()

    // Outbound user message preserved & deduped against inbound echo
    const userMsgs = entries.filter(e => e.type === 'user_message')
    expect(userMsgs).toHaveLength(1)
    expect(userMsgs[0]!.content).toBe('Hello from outbound')

    // Pending permission re-emitted on reload & tool card is waiting_for_confirmation
    expect(permissions).toHaveLength(1)
    expect(permissions[0]!.requestId).toBe('perm_1')
    const toolEntry = entries.find(e => e.type === 'tool_call')
    expect(toolEntry?.toolCall.status).toBe('waiting_for_confirmation')

    // Tasks restored from task_state
    expect(capturedTasks).toEqual([
      { id: 't1', subject: 'Fix bug', status: 'in_progress' },
    ])

    // SSE opened with from_sequence_num=5
    expect(MockEventSource.instances).toHaveLength(1)
    const es = MockEventSource.instances[0]!
    expect(es.url).toContain('from_sequence_num=5')
    expect(adapter.getLastSeqNum()).toBe(5)

    // Duplicate seqNum <= 5 is ignored
    es.emitMessage({
      id: 'ev-5',
      type: 'assistant',
      seqNum: 5,
      payload: { content: 'duplicate' },
    })
    expect(
      entries.filter(
        e =>
          e.type === 'assistant_message' && e.chunks[0]?.text === 'duplicate',
      ),
    ).toHaveLength(0)

    // Live user-embedded tool_result pairs with tu_1 and marks complete
    es.emitMessage({
      id: 'ev-6',
      type: 'user',
      seqNum: 6,
      payload: {
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: 'file.ts',
              is_error: false,
            },
          ],
        },
      },
    })
    const updatedTool = entries.find(e => e.type === 'tool_call')
    expect(updatedTool?.toolCall.status).toBe('complete')
    expect(updatedTool?.toolCall.rawOutput).toEqual({ output: 'file.ts' })

    // Live result_success clears loading
    es.emitMessage({
      id: 'ev-7',
      type: 'result_success',
      seqNum: 7,
      payload: {},
    })
    expect(turnCompletedCount).toBe(1)

    // Server restart resets seqNum back to 1 — still accepted!
    es.emitError()
    es.emitMessage({
      id: 'ev-restart-1',
      type: 'status',
      seqNum: 1,
      payload: { status: 'conversation_cleared' },
    })
    expect(clearedCount).toBe(1)
    expect(entries).toHaveLength(0)

    adapter.disconnect()
  })

  test('sendMessage rolls back optimistic user entry if POST fails', async () => {
    fetchHandler = async () => ({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      data: { error: { message: 'boom' } },
    })

    let entries: ThreadEntry[] = []
    const adapter = new RCSChatAdapter('sess_rollback', action => {
      entries = typeof action === 'function' ? action(entries) : action
    })

    await expect(adapter.sendMessage('Will fail')).rejects.toThrow('boom')
    expect(entries).toHaveLength(0)
  })
})

describe('P0-D7-7: AskUserQuestion answer mapping & multiSelect safety', () => {
  test('keys answers by q.question text instead of numeric index', () => {
    const questions = [
      {
        question: 'Which framework?',
        options: [{ label: 'React' }, { label: 'Vue' }],
      },
      {
        question: 'Which features?',
        multiSelect: true,
        options: [{ label: 'SSR' }, { label: 'Tests' }],
      },
    ]

    const mapped = buildAskUserAnswers(questions, {
      '0': 0,
      '1': [0, 1],
    })
    expect(mapped).toEqual({
      'Which framework?': 'React',
      'Which features?': 'SSR, Tests',
    })
    for (const val of Object.values(mapped)) {
      expect(typeof val).toBe('string')
    }
  })

  test('P2-14: merges unsaved "Other..." text on Submit and handles empty questions array', () => {
    const questions = [
      {
        question: 'Which framework?',
        options: [{ label: 'React' }, { label: 'Vue' }],
      },
      {
        question: 'Which features?',
        multiSelect: true,
        options: [{ label: 'SSR' }, { label: 'Tests' }],
      },
    ]

    const mapped = buildAskUserAnswers(
      questions,
      { '1': [0] },
      { '0': '  Svelte  ', '1': 'Linting' },
    )
    expect(mapped).toEqual({
      'Which framework?': 'Svelte',
      'Which features?': 'SSR, Linting',
    })

    const fallbackMapped = buildAskUserAnswers(
      [],
      {},
      { '0': 'Direct answer' },
      'Any additional notes?',
    )
    expect(fallbackMapped).toEqual({
      'Any additional notes?': 'Direct answer',
    })
  })

  test('toggleMultiSelectAnswer does not crash when previous answer was an "Other..." string', () => {
    const afterOther = toggleMultiSelectAnswer('Custom answer text', 1)
    expect(afterOther).toEqual([1])
    const afterToggleOff = toggleMultiSelectAnswer(afterOther, 1)
    expect(afterToggleOff).toEqual([])
  })
})

describe('P1-D7-2 & P1-D7-4 & P1-D7-17: ACPClient state & pending request safety', () => {
  test('preserves error state across ws.onerror -> ws.onclose and rejects pending operations', async () => {
    const client = new ACPClient({ proxyUrl: 'ws://localhost:9999/ws' })
    const states: Array<{ state: string; error?: string }> = []
    client.setConnectionStateHandler((state, error) => {
      states.push({ state, error })
    })

    const connectPromise = client.connect()
    const ws = MockWebSocket.instances[0]!
    ws.receive({
      type: 'status',
      payload: {
        connected: true,
        capabilities: {
          loadSession: true,
          sessionCapabilities: { list: {} },
        },
      },
    })
    await connectPromise

    const listPromise = client.listSessions()
    ws.onerror?.()
    ws.close(1006, 'abnormal closure')

    await expect(listPromise).rejects.toThrow('abnormal closure')
    // Must stay 'error', not be clobbered to 'disconnected' by ws.onclose!
    expect(client.getState()).toBe('error')
    expect(client.agentCapabilities).toBeNull()
    expect(client.modelState).toBeNull()
  })

  test('supersedes previous pending listSessions call cleanly when a newer one starts', async () => {
    const client = new ACPClient({ proxyUrl: 'ws://localhost:9999/ws' })
    const connectPromise = client.connect()
    const ws = MockWebSocket.instances[0]!
    ws.receive({
      type: 'status',
      payload: {
        connected: true,
        capabilities: { sessionCapabilities: { list: {} } },
      },
    })
    await connectPromise

    const first = client.listSessions()
    const second = client.listSessions()

    await expect(first).rejects.toThrow('superseded')
    ws.receive({
      type: 'session_list',
      payload: { sessions: [{ sessionId: 's1', cwd: '/tmp' }] },
    })
    const res = await second
    expect(res.sessions).toHaveLength(1)
    expect(res.sessions[0]!.sessionId).toBe('s1')
    client.disconnect()
  })

  test('setSessionMode sends JSON-RPC session/set_mode and resolves on result', async () => {
    const client = new ACPClient({ proxyUrl: 'ws://localhost:9999/ws' })
    const connectPromise = client.connect()
    const ws = MockWebSocket.instances[0]!
    ws.receive({ type: 'status', payload: { connected: true } })
    await connectPromise

    ws.receive({
      type: 'session_created',
      payload: { sessionId: 'sess_acp_1' },
    })
    const modePromise = client.setSessionMode('acceptEdits')

    const sentFrame = JSON.parse(ws.sent[ws.sent.length - 1]!) as {
      jsonrpc: string
      id: string
      method: string
      params: { sessionId: string; modeId: string }
    }
    expect(sentFrame.jsonrpc).toBe('2.0')
    expect(sentFrame.method).toBe('session/set_mode')
    expect(sentFrame.params).toEqual({
      sessionId: 'sess_acp_1',
      modeId: 'acceptEdits',
    })

    ws.receive({ jsonrpc: '2.0', id: sentFrame.id, result: {} })
    await expect(modePromise).resolves.toBeUndefined()
    client.disconnect()
  })

  test('P1-12: setSessionMode resolves on relay session_mode_set frame and rejects on error frame', async () => {
    const client = new ACPClient({
      proxyUrl: 'ws://localhost:9999/acp/relay/a1',
    })
    const connectPromise = client.connect()
    const ws = MockWebSocket.instances[0]!
    ws.receive({ type: 'status', payload: { connected: true } })
    await connectPromise

    ws.receive({
      type: 'session_created',
      payload: { sessionId: 'sess_relay_1' },
    })

    const modeOk = client.setSessionMode('plan')
    ws.receive({ type: 'session_mode_set', payload: {} })
    await expect(modeOk).resolves.toBeUndefined()

    const modeFail = client.setSessionMode('bypassPermissions')
    ws.receive({
      type: 'error',
      payload: { message: 'bypassPermissions not allowed' },
    })
    await expect(modeFail).rejects.toThrow('bypassPermissions not allowed')

    client.disconnect()
  })

  test('P1-12: applyPermissionModeChange rolls back state and localStorage when setSessionMode rejects', async () => {
    let mode = 'default'
    let lastErr: string | null = null
    lsStore['acp_permission_mode'] = 'default'
    const seqRef = { current: 0 }

    await applyPermissionModeChange({
      nextMode: 'bypassPermissions',
      previousMode: mode,
      seqRef,
      setMode: m => {
        mode = m
      },
      setModeOnClient: async () => {
        throw new Error('Mode rejected by agent')
      },
      onError: msg => {
        lastErr = msg
      },
      shouldSyncClient: true,
    })

    expect(mode).toBe('default')
    expect(lsStore['acp_permission_mode']).toBe('default')
    expect(lastErr).toBe('Mode rejected by agent')

    // Stale failure does NOT roll back a newer successful selection
    let rejectFirst!: (err: Error) => void
    const firstPromise = applyPermissionModeChange({
      nextMode: 'plan',
      previousMode: 'default',
      seqRef,
      setMode: m => {
        mode = m
      },
      setModeOnClient: () =>
        new Promise((_, reject) => {
          rejectFirst = reject
        }),
      onError: msg => {
        lastErr = msg
      },
      shouldSyncClient: true,
    })
    const secondPromise = applyPermissionModeChange({
      nextMode: 'acceptEdits',
      previousMode: 'plan',
      seqRef,
      setMode: m => {
        mode = m
      },
      setModeOnClient: async () => {},
      onError: msg => {
        lastErr = msg
      },
      shouldSyncClient: true,
    })
    await secondPromise
    rejectFirst(new Error('Stale rejection'))
    await firstPromise

    expect(mode).toBe('acceptEdits')
    expect(lsStore['acp_permission_mode']).toBe('acceptEdits')
  })

  test('P1-13: ensureInitialAcpSession handles StrictMode double-call + expired lastSessionId fallback + reconnect', async () => {
    const client = new ACPClient({ proxyUrl: 'ws://localhost:9999/ws' })
    const connectPromise = client.connect()
    const ws1 = MockWebSocket.instances[0]!
    ws1.receive({
      type: 'status',
      payload: {
        connected: true,
        capabilities: { loadSession: true },
      },
    })
    await connectPromise

    // StrictMode Mount 1 & Mount 2 both call ensureInitialAcpSession while loadSession is in flight
    const p1 = ensureInitialAcpSession(client, {
      lastSessionId: 'stale_session',
      permissionMode: 'acceptEdits',
    })
    const p2 = ensureInitialAcpSession(client, {
      lastSessionId: 'stale_session',
      permissionMode: 'acceptEdits',
    })
    expect(p1).toBe(p2)

    const loadFrames = ws1.sent
      .map(s => JSON.parse(s) as { type?: string })
      .filter(f => f.type === 'load_session')
    expect(loadFrames).toHaveLength(1)

    // Expired session fails -> MUST fall back to createSession instead of wedging!
    ws1.receive({ type: 'error', payload: { message: 'Session expired' } })
    await p1

    const newSessionFrames = ws1.sent
      .map(
        s =>
          JSON.parse(s) as {
            type?: string
            payload?: { permissionMode?: string }
          },
      )
      .filter(f => f.type === 'new_session')
    expect(newSessionFrames).toHaveLength(1)
    expect(newSessionFrames[0]!.payload?.permissionMode).toBe('acceptEdits')

    // Disconnect and reconnect on same client -> must be able to initialize a new session again
    client.disconnect()
    clearInitialAcpSession(client)

    const reconnectPromise = client.reconnect()
    const ws2 = MockWebSocket.instances[1]!
    ws2.receive({
      type: 'status',
      payload: { connected: true, capabilities: {} },
    })
    await reconnectPromise

    await ensureInitialAcpSession(client, {
      lastSessionId: null,
      permissionMode: 'default',
    })
    const reconnectNewFrames = ws2.sent
      .map(s => JSON.parse(s) as { type?: string })
      .filter(f => f.type === 'new_session')
    expect(reconnectNewFrames).toHaveLength(1)

    client.disconnect()
  })

  test('P2-15: connect() settles superseded promise and rejects on status connected:false', async () => {
    const client = new ACPClient({ proxyUrl: 'ws://localhost:9999/ws' })

    const firstConnect = client.connect()
    const secondConnect = client.connect()
    await expect(firstConnect).rejects.toBeInstanceOf(DisconnectRequestedError)

    const ws2 = MockWebSocket.instances[1]!
    ws2.receive({ type: 'status', payload: { connected: false } })
    await expect(secondConnect).rejects.toThrow('Agent disconnected')
    expect(client.getState()).toBe('error')

    client.disconnect()
  })
})

describe('P0-3, P1-16, P1-17, P2-16: RCSChatAdapter StrictMode, optimistic dequeue, seqNum===1 reset & result tool finalization', () => {
  test('P0-3: StrictMode mount -> disconnect -> remount re-initializes cleanly without bricking or dropping history', async () => {
    const historyEvents: SessionEvent[] = [
      {
        id: 'ev-u1',
        type: 'user',
        direction: 'outbound',
        seqNum: 1,
        payload: { uuid: 'uuid-u1', content: 'StrictMode hello' },
      },
      {
        id: 'ev-a1',
        type: 'assistant',
        direction: 'inbound',
        seqNum: 2,
        payload: { content: 'StrictMode reply' },
      },
    ]

    let resolveFirstHistory!: () => void
    let notifyFirstHistoryStarted!: () => void
    const firstHistoryStarted = new Promise<void>(r => {
      notifyFirstHistoryStarted = r
    })
    let historyCalls = 0
    fetchHandler = async url => {
      if (url.endsWith('/history')) {
        historyCalls++
        if (historyCalls === 1) {
          notifyFirstHistoryStarted()
          await new Promise<void>(r => {
            resolveFirstHistory = r
          })
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          data: { events: historyEvents },
        }
      }
      return { ok: true, status: 200, statusText: 'OK', data: { ok: true } }
    }

    let entries: ThreadEntry[] = []
    const adapter = new RCSChatAdapter('sess_strict', action => {
      entries = typeof action === 'function' ? action(entries) : action
    })

    // Mount 1 starts init() and enters loadHistory(), then StrictMode cleanup disconnects mid-flight
    const mount1 = adapter.init()
    await firstHistoryStarted
    adapter.disconnect()
    expect(adapter.isDisposed()).toBe(true)

    // Mount 2 re-initializes the SAME adapter instance
    const mount2 = adapter.init()
    await mount2

    // Mount 1's stale history finishes late — must NOT clobber Mount 2
    resolveFirstHistory()
    await mount1

    expect(adapter.isDisposed()).toBe(false)
    expect(entries.filter(e => e.type === 'user_message')).toHaveLength(1)
    expect(entries.filter(e => e.type === 'assistant_message')).toHaveLength(1)
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0]!.closed).toBe(false)

    // Also verify a completed Mount 1 -> disconnect -> Mount 2 remount still renders user messages
    adapter.disconnect()
    entries = []
    await adapter.init()
    expect(entries.filter(e => e.type === 'user_message')).toHaveLength(1)
    expect(entries.filter(e => e.type === 'user_message')[0]!.content).toBe(
      'StrictMode hello',
    )
    adapter.disconnect()
  })

  test('P1-16: UUID-matched user echo dequeues pending optimistic entry so later non-UUID same-text message is preserved', async () => {
    let sentUuid = ''
    fetchHandler = async (url, opts) => {
      if (url.endsWith('/history')) {
        return { ok: true, status: 200, statusText: 'OK', data: { events: [] } }
      }
      if (url.endsWith('/events') && opts?.method === 'POST') {
        const body = JSON.parse(String(opts.body)) as { uuid: string }
        sentUuid = body.uuid
      }
      return { ok: true, status: 200, statusText: 'OK', data: { ok: true } }
    }

    let entries: ThreadEntry[] = []
    const adapter = new RCSChatAdapter('sess_opt', action => {
      entries = typeof action === 'function' ? action(entries) : action
    })
    await adapter.init()
    const es = MockEventSource.instances[0]!

    await adapter.sendMessage('ping')
    expect(entries.filter(e => e.type === 'user_message')).toHaveLength(1)

    // UUID-matched echo deduplicates and dequeues optimistic entry
    es.emitMessage({
      id: 'ev-echo-1',
      type: 'user',
      seqNum: 1,
      payload: { uuid: sentUuid, content: 'ping' },
    })
    expect(entries.filter(e => e.type === 'user_message')).toHaveLength(1)

    // Later non-UUID message with identical text MUST NOT be eaten
    es.emitMessage({
      id: 'ev-other-2',
      type: 'user',
      seqNum: 2,
      payload: { content: 'ping' },
    })
    expect(entries.filter(e => e.type === 'user_message')).toHaveLength(2)

    adapter.disconnect()
  })

  test('P1-17: accepts seqNum === 1 after server restart when lastSeqNum === 1 across adapter, sse.ts, and sseBus', async () => {
    fetchHandler = async url => {
      if (url.endsWith('/history')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          data: {
            events: [
              {
                id: 'ev-before-1',
                type: 'assistant',
                seqNum: 1,
                payload: { content: 'before restart' },
              },
            ],
          },
        }
      }
      return { ok: true, status: 200, statusText: 'OK', data: { ok: true } }
    }

    let entries: ThreadEntry[] = []
    const adapter = new RCSChatAdapter('sess_seq1', action => {
      entries = typeof action === 'function' ? action(entries) : action
    })
    await adapter.init()
    expect(adapter.getLastSeqNum()).toBe(1)

    const adapterEs = MockEventSource.instances[0]!
    adapterEs.emitError()
    adapterEs.emitMessage({
      id: 'ev-after-1',
      type: 'assistant',
      seqNum: 1,
      payload: { content: ' after restart' },
    })
    expect(entries).toHaveLength(1)
    expect(
      entries[0]?.type === 'assistant_message'
        ? entries[0].chunks[0]?.text
        : '',
    ).toBe('before restart after restart')
    adapter.disconnect()

    // Also verify api/sse.ts connectSSE
    const sseReceived: SessionEvent[] = []
    connectSSE('sess_sse1', ev => sseReceived.push(ev), 0)
    const sseEs = MockEventSource.instances[1]!
    sseEs.emitMessage({
      id: 'sse-old-1',
      type: 'assistant',
      seqNum: 1,
      payload: { content: 'a' },
    })
    sseEs.emitError()
    sseEs.emitMessage({
      id: 'sse-new-1',
      type: 'assistant',
      seqNum: 1,
      payload: { content: 'b' },
    })
    expect(sseReceived.map(e => e.id)).toEqual(['sse-old-1', 'sse-new-1'])
    disconnectSSE()

    // Also verify lib/rcs-transport.ts sseBus
    const busReceived: SessionEvent[] = []
    const unsub = sseBus.onEvent(ev => busReceived.push(ev))
    sseBus.connect('sess_bus1', 0)
    const busEs = MockEventSource.instances[2]!
    busEs.emitMessage({
      id: 'bus-old-1',
      type: 'assistant',
      seqNum: 1,
      payload: { content: 'a' },
    })
    busEs.emitError()
    busEs.emitMessage({
      id: 'bus-new-1',
      type: 'assistant',
      seqNum: 1,
      payload: { content: 'b' },
    })
    expect(busReceived.map(e => e.id)).toEqual(['bus-old-1', 'bus-new-1'])
    unsub()
    sseBus.disconnect()
  })

  test('P2-16: live result_success finalizes unpaired running tool calls to complete', async () => {
    fetchHandler = async url => {
      if (url.endsWith('/history')) {
        return { ok: true, status: 200, statusText: 'OK', data: { events: [] } }
      }
      return { ok: true, status: 200, statusText: 'OK', data: { ok: true } }
    }

    let entries: ThreadEntry[] = []
    const adapter = new RCSChatAdapter('sess_res', action => {
      entries = typeof action === 'function' ? action(entries) : action
    })
    await adapter.init()
    const es = MockEventSource.instances[0]!

    es.emitMessage({
      id: 'ev-t1',
      type: 'tool_use',
      seqNum: 1,
      payload: {
        tool_call_id: 'tc_unpaired',
        tool_name: 'Read',
        tool_input: {},
      },
    })
    expect(entries[0]?.type === 'tool_call' && entries[0].toolCall.status).toBe(
      'running',
    )

    es.emitMessage({
      id: 'ev-r2',
      type: 'result_success',
      seqNum: 2,
      payload: {},
    })
    expect(entries[0]?.type === 'tool_call' && entries[0].toolCall.status).toBe(
      'complete',
    )
    adapter.disconnect()
  })
})

describe('P0-4: App route controller under React StrictMode double-effect', () => {
  const origWindow = (globalThis as any).window
  const origSessionStorage = (globalThis as any).sessionStorage

  afterEach(() => {
    ;(globalThis as any).window = origWindow
    ;(globalThis as any).sessionStorage = origSessionStorage
  })

  function setupMockBrowser(initialHref: string) {
    const currentUrl = new URL(initialHref)
    const ss: Record<string, string> = {}
    const listeners = new Map<string, Set<() => void>>()

    ;(globalThis as any).sessionStorage = {
      getItem: (k: string) => ss[k] ?? null,
      setItem: (k: string, v: string) => {
        ss[k] = v
      },
      removeItem: (k: string) => {
        delete ss[k]
      },
    }
    ;(globalThis as any).window = {
      location: {
        get href() {
          return currentUrl.href
        },
        get pathname() {
          return currentUrl.pathname
        },
        get search() {
          return currentUrl.search
        },
      },
      history: {
        replaceState: (_state: unknown, _title: string, url: string | URL) => {
          const next = new URL(String(url), currentUrl.origin)
          currentUrl.href = next.href
        },
      },
      addEventListener: (ev: string, fn: () => void) => {
        if (!listeners.has(ev)) listeners.set(ev, new Set())
        listeners.get(ev)!.add(fn)
      },
      removeEventListener: (ev: string, fn: () => void) => {
        listeners.get(ev)?.delete(fn)
      },
      dispatchPopstate: (nextPath: string) => {
        const next = new URL(nextPath, currentUrl.origin)
        currentUrl.href = next.href
        for (const fn of listeners.get('popstate') ?? []) fn()
      },
    }
    return { ss }
  }

  test('preserves ACPDirectView across StrictMode double-effect and clears it on popstate', () => {
    const { ss } = setupMockBrowser('http://localhost:3000/code/?acp=1')
    ss['acp_connection'] = JSON.stringify({
      url: 'ws://localhost:9315/ws',
      token: 'acp-secret',
    })

    let acpDirect: { url: string; token: string } | null = null
    let currentSessionId: string | null = null
    let bindingSession = false

    const refs = {
      bindSeqRef: { current: 0 },
      initialRouteParsedRef: { current: false },
    }
    const controller = createRouteController(
      {
        getUuid: () => 'u1',
        setUuid: () => {},
        syncDefaultUuid: () => {},
        apiBind: async () => {},
        setAcpDirect: v => {
          acpDirect = v
        },
        setCurrentSessionId: v => {
          currentSessionId = v
        },
        setSessionMeta: () => {},
        setBindingSession: v => {
          bindingSession = v
        },
      },
      refs,
    )

    // StrictMode Mount 1 -> Cleanup -> Mount 2
    const cleanup1 = controller.attachRouteEffect()
    cleanup1()
    const cleanup2 = controller.attachRouteEffect()

    expect(acpDirect).toEqual({
      url: 'ws://localhost:9315/ws',
      token: 'acp-secret',
    })
    expect(currentSessionId).toBeNull()
    expect(bindingSession).toBe(false)

    // Real popstate navigation clears acpDirect
    ;(globalThis as any).window.dispatchPopstate('/code/')
    expect(acpDirect).toBeNull()
    cleanup2()
  })

  test('does not cancel in-flight ?sid= apiBind or mount SessionDetail early under StrictMode', async () => {
    setupMockBrowser('http://localhost:3000/code/?sid=session_123')

    let resolveBind!: () => void
    let bindCalls = 0
    let currentSessionId: string | null = null
    let bindingSession = false

    const refs = {
      bindSeqRef: { current: 0 },
      initialRouteParsedRef: { current: false },
    }
    const controller = createRouteController(
      {
        getUuid: () => 'u1',
        setUuid: () => {},
        syncDefaultUuid: () => {},
        apiBind: async () => {
          bindCalls++
          await new Promise<void>(r => {
            resolveBind = r
          })
        },
        setAcpDirect: () => {},
        setCurrentSessionId: v => {
          currentSessionId = v
        },
        setSessionMeta: () => {},
        setBindingSession: v => {
          bindingSession = v
        },
      },
      refs,
    )

    // StrictMode Mount 1 -> Cleanup -> Mount 2
    const cleanup1 = controller.attachRouteEffect()
    cleanup1()
    const cleanup2 = controller.attachRouteEffect()

    // While apiBind is in flight, SessionDetail MUST NOT mount yet (no 403 race!)
    expect(bindCalls).toBe(1)
    expect(bindingSession).toBe(true)
    expect(currentSessionId).toBeNull()

    resolveBind()
    await new Promise<void>(r => setTimeout(r, 0))

    expect(bindingSession).toBe(false)
    expect(currentSessionId).toBe('session_123')
    cleanup2()
  })
})

describe('P1-11: MessageBubble safe raster MIME allowlist prevents image/svg+xml XSS', () => {
  const origWindow = (globalThis as any).window
  const origCreateObjectURL = URL.createObjectURL
  const origRevokeObjectURL = URL.revokeObjectURL

  afterEach(() => {
    ;(globalThis as any).window = origWindow
    URL.createObjectURL = origCreateObjectURL
    URL.revokeObjectURL = origRevokeObjectURL
  })

  test('downgrades image/svg+xml and non-raster MIMEs to application/octet-stream in openImageSafely', () => {
    expect(
      sanitizeImageMimeType('image/svg+xml', 'application/octet-stream'),
    ).toBe('application/octet-stream')
    expect(
      sanitizeImageMimeType(
        'IMAGE/SVG+XML;charset=utf-8',
        'application/octet-stream',
      ),
    ).toBe('application/octet-stream')
    expect(sanitizeImageMimeType('text/html', 'application/octet-stream')).toBe(
      'application/octet-stream',
    )
    expect(
      sanitizeImageMimeType(' IMAGE/PNG ', 'application/octet-stream'),
    ).toBe('image/png')
    expect(
      sanitizeImageMimeType('image/webp', 'application/octet-stream'),
    ).toBe('image/webp')

    let createdBlob: Blob | null = null
    let openedArgs: unknown[] = []
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      createdBlob = blob as Blob
      return 'blob:test-safe'
    }
    URL.revokeObjectURL = () => {}
    ;(globalThis as any).window = {
      open: (...args: unknown[]) => {
        openedArgs = args
        return null
      },
    }

    openImageSafely({
      mimeType: 'image/svg+xml',
      data: btoa('<svg onload="alert(1)"/>'),
    })

    expect(createdBlob).not.toBeNull()
    expect(createdBlob!.type).toBe('application/octet-stream')
    expect(openedArgs).toEqual([
      'blob:test-safe',
      '_blank',
      'noopener,noreferrer',
    ])
  })
})

describe('P2-12 & P2-13: Storage fallback UUID & default-mode Bearer token suppression', () => {
  test('P2-12: getUuid returns stable in-memory fallback and setUuid does not throw when localStorage throws', () => {
    ;(globalThis as any).localStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
      clear: () => {},
      length: 0,
      key: () => null,
    }

    const u1 = getUuid()
    const u2 = getUuid()
    expect(u1).toBe(u2)
    expect(u1).toBeTruthy()

    expect(() => setUuid('imported-stable-uuid')).not.toThrow()
    expect(getUuid()).toBe('imported-stable-uuid')
  })

  test('P2-13: resolveActiveApiToken returns null in default mode and API key for custom tokens', () => {
    const tokens = [
      { id: DEFAULT_TOKEN_ID, token: 'browser-uuid-123', label: 'Default' },
      { id: 'tk_work', token: 'rcs-api-key-secret', label: 'Work' },
    ]
    expect(resolveActiveApiToken(tokens, DEFAULT_TOKEN_ID)).toBeNull()
    expect(resolveActiveApiToken(tokens, 'tk_work')).toBe('rcs-api-key-secret')
  })
})
