output_tokens + _.output_tokens, server_tool_use
:
{
  web_search_requests: H.server_tool_use.web_search_requests +
    _.server_tool_use.web_search_requests,
    web_fetch_requests
  :H.server_tool_use.web_fetch_requests+_.server_tool_use.web_fetch_requests
}
,service_tier:_.service_tier,cache_creation:
{
  ephemeral_1h_input_tokens: H.cache_creation.ephemeral_1h_input_tokens +
    _.cache_creation.ephemeral_1h_input_tokens,
    ephemeral_5m_input_tokens
  :H.cache_creation.ephemeral_5m_input_tokens+_.cache_creation.ephemeral_5m_input_tokens
}
,inference_geo:_.inference_geo,iterations:_.iterations,speed:_.speed}}
function EDO(H, _, q, K = !1, O) {
  let T = w => {
      let j = w
      while (j >= 0 && H[j].type === 'api_system') j--
      return j
    },
    z = T(H.length - 1)
  if (K) z = T(z - 1)
  let $ = new Set()
  if (z >= 0) $.add(z)
  let Y = !1
  if (z__()) {
    if (O) {
      let w = H.findLastIndex(j => j.uuid === O)
      if (w >= 0 && w <= z) {
        let j = K && w === z && AZK() ? T(w - 1) : w
        if (j >= 0) $.add(j), (Y = !0)
      }
    } else if (!K) {
      let w = T(z - 1)
      if (w >= 0) $.add(w), (Y = !0)
    }
  }
  return (
    c('tengu_api_cache_breakpoints', {
      totalMessageCount: H.length,
      cachingEnabled: _,
      skipCacheWrite: K,
      forkPointPinned: Y,
      markerCount: $.size,
    }),
    H.map((w, j) => {
      let J = $.has(j)
      if (w.type === 'user') return PDO(w, J, _, q)
      if (w.type === 'api_system')
        return { role: 'system', content: w.message.content }
      return WDO(w, J, _, q)
    })
  )
}
function SDO(H, _, q) {
  return uqq(H, {
    skipGlobalCacheForSystemPrompt: q?.skipGlobalCacheForSystemPrompt,
  }).map(K => {
    return {
      type: 'text',
      text: K.text,
      ...(_ &&
        K.cacheScope !== null && {
          cache_control: uo({ scope: K.cacheScope, ttl: q?.cacheTtl }),
        }),
    }
  })
}
async function hh({
  systemPrompt: H = G4([]),
  userPrompt: _,
  outputFormat: q,
  signal: K,
  options: O,
}) {
  return (
    await nZ6(
      [
        R6({ content: H.map(z => ({ type: 'text', text: z })) }),
        R6({ content: _ }),
      ],
      async () => {
        let z = [R6({ content: _ })]
        return [
          await UCH({
            messages: z,
            systemPrompt: H,
            thinkingConfig: { type: 'disabled' },
            tools: [],
            signal: K,
            options: {
              ...O,
              model: VP(),
              enablePromptCaching: O.enablePromptCaching ?? !1,
              outputFormat: q,
              async getToolPermissionContext() {
                return nZ()
              },
            },
          }),
        ]
      },
    )
  )[0]
}
async function XXH({
  systemPrompt: H = G4([]),
  userPrompt: _,
  outputFormat: q,
  signal: K,
  options: O,
}) {
  return (
    await nZ6(
      [
        R6({ content: H.map(z => ({ type: 'text', text: z })) }),
        R6({ content: _ }),
      ],
      async () => {
        let z = [R6({ content: _ })]
        return [
          await UCH({
            messages: z,
            systemPrompt: H,
            thinkingConfig: { type: 'disabled' },
            tools: [],
            signal: K,
            options: {
              ...O,
              enablePromptCaching: O.enablePromptCaching ?? !1,
              outputFormat: q,
              async getToolPermissionContext() {
                return nZ()
              },
            },
          }),
        ]
      },
    )
  )[0]
}
function IDO(H, _) {
  let q = Math.min(H.max_tokens, _),
    K = { ...H }
  if (K.thinking?.type === 'enabled' && K.thinking.budget_tokens)
    K.thinking = {
      ...K.thinking,
      budget_tokens: Math.min(K.thinking.budget_tokens, q - 1),
    }
  return { ...K, max_tokens: q }
}
function G5H(H) {
  let _ = zwH(H)
  return b_H(
    'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
    process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
    _.default,
    _.upperLimit,
  ).effective
}
var c8_,
  Uqq,
  NDO = 1e4,
  vDO = 30,
  CDO = 64000
var zJ = R(() => {
  GK()
  y66()
  p9()
  TSH()
  jq()
  J0()
  mr_()
  n6()
  NP()
  FY()
  c_()
  W_()
  pqq()
  W6()
  B8()
  mq()
  Hv()
  A6()
  i6()
  RC()
  INH()
  e9H()
  J_()
  sy()
  nC()
  ob()
  i6()
  s_H()
  xb()
  jq()
  J0()
  NP()
  lH()
  O$()
  FY()
  RP()
  vEH()
  qV_()
  l1H()
  Xe()
  vSH()
  R8()
  lb()
  oC()
  Fr()
  xd()
  ilH()
  i76()
  W3()
  JKH()
  Nh()
  mq()
  UEH()
  i_()
  zi8()
  tx()
  N_()
  G8H()
  Ld8()
  MgH()
  gN()
  V1H()
  XR6()
  PV_()
  FMH()
  yvH()
  ;(c8_ = require('crypto')), (Uqq = (k8H(), W8(C3H)))
})
function bDO(H) {
  let _ = H.find(O => O.role === 'user')
  if (!_) return ''
  let q = _.content
  if (typeof q === 'string') return q
  let K = q.find(O => O.type === 'text')
  return K?.type === 'text' ? K.text : ''
}
async function ex(H) {
  let {
      model: _,
      system: q,
      messages: K,
      tools: O,
      tool_choice: T,
      output_format: z,
      max_tokens: $ = 1024,
      maxRetries: Y = 2,
      timeout: A,
      signal: w,
      skipSystemPromptPrefix: j,
      temperature: J,
      thinking: M,
      stop_sequences: D,
      extraBodyParams: f,
      onFetchAttempt: X,
    } = H,
    P = await Cp({
      maxRetries: Y,
      model: _,
      source: 'side_query',
      ...(X && {
        fetchOverride: (l, d) => {
          return X(), globalThis.fetch(l, d)
        },
      }),
    }),
    G = [...Ip(_)],
    W = Boolean(z) && eRH(_)
  if (W && !G.includes(Me)) G.push(Me)
  let Z = bDO(K),
    L = mqq(
      Z,
      {
        ISSUES_EXPLAINER:
          'report the issue at https://github.com/anthropics/claude-code/issues',
        PACKAGE_URL: '@anthropic-ai/claude-code',
        README_URL: 'https://code.claude.com/docs/en/overview',
        VERSION: '2.1.153',
        FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
        BUILD_TIME: '2026-05-27T20:03:21Z',
        GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
      }.VERSION,
    ),
    k = ur_(L),
    v = [
      k ? { type: 'text', text: k } : null,
      ...(j
        ? []
        : [
            {
              type: 'text',
              text: v66({ isNonInteractive: !1, hasAppendSystemPrompt: !1 }),
            },
          ]),
      ...(Array.isArray(q) ? q : q ? [{ type: 'text', text: q }] : []),
    ].filter(l => l !== null),
    E
  if (M === !1) E = { type: 'disabled' }
  else if (M !== void 0)
    E = { type: 'enabled', budget_tokens: Math.min(M, $ - 1) }
  let h = WvH(H.querySource) ? '1h' : void 0
  if (h === '1h' && gZ() && !G.includes(PGH)) G.push(PGH)
  let C = h ? v.map(l => J64(l, h)) : v,
    I = h
      ? K.map(l =>
          typeof l.content === 'string'
            ? l
            : { ...l, content: l.content.map(d => J64(d, h)) },
        )
      : K,
    b = kP(_),
    m = performance.now(),
    S = await P.beta.messages.create(
      {
        model: b,
        max_tokens: $,
        system: C,
        messages: I,
        ...(O && { tools: O }),
        ...(T && { tool_choice: T }),
        ...(W && { output_config: { format: z } }),
        ...(J !== void 0 && _H6(b) && { temperature: J }),
        ...(D && { stop_sequences: D }),
        ...(E && { thinking: E }),
        ...(G.length > 0 && { betas: GP(G) }),
        metadata: CjH(),
        ...f,
      },
      { signal: w, ...(A !== void 0 && { timeout: A }) },
    ),
    x = S._request_id ?? void 0,
    U = performance.now(),
    g = Date.now(),
    Q = XzH()
  return (
    c('tengu_api_success', {
      requestId: x,
      querySource: H.querySource,
      model: b,
      inputTokens: S.usage.input_tokens,
      outputTokens: S.usage.output_tokens,
      cachedInputTokens: S.usage.cache_read_input_tokens ?? 0,
      uncachedInputTokens: S.usage.cache_creation_input_tokens ?? 0,
      durationMsIncludingRetries: Math.max(0, Math.round(U - m)),
      stop_reason: S.stop_reason ?? void 0,
      timeSinceLastApiCallMs:
        Q !== null ? Math.max(0, Math.round(g - Q)) : void 0,
      ...cD_(H.querySource, Bd(H.querySource, void 0, void 0)),
    }),
    _7_(g),
    S
  )
}
function J64(H, _) {
  if (!('cache_control' in H) || !H.cache_control || H.cache_control.ttl)
    return H
  return { ...H, cache_control: { ...H.cache_control, ttl: _ } }
}
var ADH = R(() => {
  J_()
  sy()
  y66()
  N_()
  zJ()
  MgH()
  J0()
  mr_()
  pqq()
  l1H()
  mq()
})
var Fc8 = {}
f_(Fc8, {
  runClaudeInChromeMcpServer: () => FDO,
  createChromeContext: () => D64,
})
function pDO(H) {
  return M64.some(_ => _ === H)
}
function BDO() {
  if (xH(process.env.USE_LOCAL_OAUTH) || xH(process.env.LOCAL_BRIDGE))
    return 'ws://localhost:8765'
  if (xH(process.env.USE_STAGING_OAUTH))
    return 'wss://bridge-staging.claudeusercontent.com'
  return 'wss://bridge.claudeusercontent.com'
}
function UDO() {
  return xH(process.env.USE_LOCAL_OAUTH) || xH(process.env.LOCAL_BRIDGE)
}
function D64(H) {
  let _ = new f64(),
    q = BDO()
  _.info(`Bridge URL: ${q}`)
  let K =
      H?.CLAUDE_CHROME_PERMISSION_MODE ??
      process.env.CLAUDE_CHROME_PERMISSION_MODE,
    O
  if (K)
    if (pDO(K)) O = K
    else
      _.warn(
        `Invalid CLAUDE_CHROME_PERMISSION_MODE "${K}". Valid values: ${M64.join(', ')}`,
      )
  return {
    serverName: 'Claude in Chrome',
    logger: _,
    socketPath: pT6(),
    getSocketPaths: Ak7,
    clientTypeId: 'claude-code',
    onAuthenticationError: () => {
      _.warn(
        'Authentication error occurred. Please ensure you are logged into the Claude browser extension with the same claude.ai account as Claude Code.',
      )
    },
    onToolCallDisconnected: () => {
      return `Browser extension is not connected. Please ensure the Claude browser extension is installed and running (${xDO}), and that you are logged into claude.ai with the same account as Claude Code. If this is your first time connecting to Chrome, you may need to restart Chrome for the installation to take effect. If you continue to experience issues, please report a bug: ${uDO}`
    },
    onExtensionPaired: (T, z) => {
      O6($ => {
        if (
          $.chromeExtension?.pairedDeviceId === T &&
          $.chromeExtension?.pairedDeviceName === z
        )
          return $
        return {
          ...$,
          chromeExtension: { pairedDeviceId: T, pairedDeviceName: z },
        }
      }),
        _.info(`Paired with "${z}" (${T.slice(0, 8)})`)
    },
    getPersistedDeviceId: () => {
      return b_().chromeExtension?.pairedDeviceId
    },
    bridgeConfig: {
      url: q,
      getUserId: async () => {
        return (
          b_().oauthAccount?.accountUuid || process.env.CLAUDE_CODE_ACCOUNT_UUID
        )
      },
      getOAuthToken: async () => {
        return await DA().catch(() => {}), d9()?.accessToken ?? ''
      },
      getWsOptions: () => {
        let T = hg(),
          z = Jp(q)
        if (!T && !z) return
        return { ...T, ...(z && { proxy: z }) }
      },
      ...(UDO() && { devUserId: 'dev_user_local' }),
    },
    ...(O && { initialPermissionMode: O }),
    ...!1,
    trackEvent: (T, z) => {
      let $ = {}
      if (z)
        for (let [Y, A] of Object.entries(z)) {
          let w = Y === 'status' ? 'bridge_status' : Y
          if (typeof A === 'boolean' || typeof A === 'number') $[w] = A
          else if (typeof A === 'string' && mDO.has(w)) $[w] = A
        }
      c(T, $)
    },
  }
}
async function FDO() {
  return jK('chrome_mcp_server_start', async () => {
    V4H(), vLH()
    let H = D64(),
      _ = Wp_(H),
      q = new U0H(),
      K = !1,
      O = async () => {
        if (K) return
        ;(K = !0), await kQ(), await hQ(), process.exit(0)
      }
    process.stdin.on('end', () => void O()),
      process.stdin.on('error', () => void O()),
      N('[Claude in Chrome] Starting MCP server'),
      await _.connect(q),
      N('[Claude in Chrome] MCP server started')
  })
}
class f64 {
  silly(H, ..._) {
    N(l8_.format(H, ..._), { level: 'debug' })
  }
  debug(H, ..._) {
    N(l8_.format(H, ..._), { level: 'debug' })
  }
  info(H, ..._) {
    N(l8_.format(H, ..._), { level: 'info' })
  }
  warn(H, ..._) {
    N(l8_.format(H, ..._), { level: 'warn' })
  }
  error(H, ..._) {
    N(l8_.format(H, ..._), { level: 'error' })
  }
}
var l8_,
  xDO = 'https://claude.ai/chrome',
  uDO =
    'https://github.com/anthropics/claude-code/issues/new?labels=bug,claude-in-chrome',
  mDO,
  M64
var gc8 = R(() => {
  _c6()
  Rp_()
  EQ()
  A6()
  $k()
  N_()
  GHH()
  jq()
  n6()
  lH()
  c_()
  zp()
  MA()
  ADH()
  eC()
  ;(l8_ = require('util')),
    (mDO = new Set(['bridge_status', 'error_type', 'tool_name'])),
    (M64 = ['ask', 'skip_all_permission_checks', 'follow_a_plan'])
})
var R64 = {}
f_(R64, { sendChromeMessage: () => LTH, runChromeNativeHost: () => QDO })
function Cf(H, ..._) {
  if (X64) {
    let q = new Date().toISOString(),
      K = _.length > 0 ? ' ' + CH(_) : '',
      O = `[${q}] [Claude Chrome Native Host] ${H}${K}
`
    nE.appendFile(X64, O).catch(() => {})
  }
  console.error(`[Claude Chrome Native Host] ${H}`, ..._)
}
function LTH(H) {
  let _ = Buffer.from(H, 'utf-8'),
    q = Buffer.alloc(4)
  q.writeUInt32LE(_.length, 0), process.stdout.write(q), process.stdout.write(_)
}
async function QDO() {
  return jK('chrome_native_host_run', async () => {
    Cf('Initializing...')
    let H = new Z64(),
      _ = new G64()
    await H.start()
    while (!0) {
      let q = await _.read()
      if (q === null) break
      await H.handleMessage(q)
    }
    await H.stop()
  })
}
class Z64 {
  mcpClients = new Map()
  nextClientId = 1
  server = null
  running = !1
  socketPath = null
  async start() {
    if (this.running) return
    if (((this.socketPath = pT6()), Vh6.platform() !== 'win32')) {
      let H = _P_()
      await nE.unlink(H).catch(() => {}),
        await nE.mkdir(H, { recursive: !0, mode: 448 }),
        await nE.chmod(H, 448).catch(() => {})
      try {
        let _ = await nE.readdir(H)
        for (let q of _) {
          if (!q.endsWith('.sock')) continue
          let K = parseInt(q.replace('.sock', ''), 10)
          if (isNaN(K)) continue
          try {
            process.kill(K, 0)
          } catch {
            await nE.unlink(W64.join(H, q)).catch(() => {}),
              Cf(`Removed stale socket for PID ${K}`)
          }
        }
      } catch {}
    }
    if (
      (Cf(`Creating socket listener: ${this.socketPath}`),
      (this.server = P64.createServer(H => this.handleMcpClient(H))),
      await new Promise((H, _) => {
        this.server.listen(this.socketPath, () => {
          Cf('Socket server listening for connections'),
            (this.running = !0),
            H()
        }),
          this.server.on('error', q => {
            Cf('Socket server error:', q), _(q)
          })
      }),
      Vh6.platform() !== 'win32')
    )
      try {
        await nE.chmod(this.socketPath, 384),
          Cf('Socket permissions set to 0600')
      } catch (H) {
        Cf('Failed to set socket permissions:', H)
      }
  }
  async stop() {
    if (!this.running) return
    for (let [, H] of this.mcpClients) H.socket.destroy()
    if ((this.mcpClients.clear(), this.server))
      await new Promise(H => {
        this.server.close(() => H())
      }),
        (this.server = null)
    if (Vh6.platform() !== 'win32' && this.socketPath) {
      try {
        await nE.unlink(this.socketPath), Cf('Cleaned up socket file')
      } catch {}
      try {
        let H = _P_()
        if ((await nE.readdir(H)).length === 0)
          await nE.rmdir(H), Cf('Removed empty socket directory')
      } catch {}
    }
    this.running = !1
  }
  async isRunning() {
    return this.running
  }
  async getClientCount() {
    return this.mcpClients.size
  }
  async handleMessage(H) {
    let _
    try {
      _ = B_(H)
    } catch (O) {
      Cf('Invalid JSON from Chrome:', O.message),
        LTH(CH({ type: 'error', error: 'Invalid message format' }))
      return
    }
    let q = dDO().safeParse(_)
    if (!q.success) {
      Cf('Invalid message from Chrome:', q.error.message),
        LTH(CH({ type: 'error', error: 'Invalid message format' }))
      return
    }
    let K = q.data
    switch ((Cf(`Handling Chrome message type: ${K.type}`), K.type)) {
      case 'ping':
        Cf('Responding to ping'),
          LTH(CH({ type: 'pong', timestamp: Date.now() }))
        break
      case 'get_status':
        LTH(CH({ type: 'status_response', native_host_version: gDO }))
        break
      case 'tool_response': {
        if (this.mcpClients.size > 0) {
          Cf(`Forwarding tool response to ${this.mcpClients.size} MCP clients`)
          let { type: O, ...T } = K,
            z = Buffer.from(CH(T), 'utf-8'),
            $ = Buffer.alloc(4)
          $.writeUInt32LE(z.length, 0)
          let Y = Buffer.concat([$, z])
          for (let [A, w] of this.mcpClients)
            try {
              w.socket.write(Y)
            } catch (j) {
              Cf(`Failed to send to MCP client ${A}:`, j)
            }
        }
        break
      }
      case 'notification': {
        if (this.mcpClients.size > 0) {
          Cf(`Forwarding notification to ${this.mcpClients.size} MCP clients`)
          let { type: O, ...T } = K,
            z = Buffer.from(CH(T), 'utf-8'),
            $ = Buffer.alloc(4)
          $.writeUInt32LE(z.length, 0)
          let Y = Buffer.concat([$, z])
          for (let [A, w] of this.mcpClients)
            try {
              w.socket.write(Y)
            } catch (j) {
              Cf(`Failed to send notification to MCP client ${A}:`, j)
            }
        }
        break
      }
      default:
        Cf(`Unknown message type: ${K.type}`),
          LTH(CH({ type: 'error', error: `Unknown message type: ${K.type}` }))
    }
  }
  handleMcpClient(H) {
    let _ = this.nextClientId++,
      q = { id: _, socket: H, buffer: Buffer.alloc(0) }
    this.mcpClients.set(_, q),
      Cf(`MCP client ${_} connected. Total clients: ${this.mcpClients.size}`),
      LTH(CH({ type: 'mcp_connected' })),
      H.on('data', K => {
        q.buffer = Buffer.concat([q.buffer, K])
        while (q.buffer.length >= 4) {
          let O = q.buffer.readUInt32LE(0)
          if (O === 0 || O > Fqq) {
            Cf(`Invalid message length from MCP client ${_}: ${O}`), H.destroy()
            return
          }
          if (q.buffer.length < 4 + O) break
          let T = q.buffer.slice(4, 4 + O)
          q.buffer = q.buffer.slice(4 + O)
          try {
            let z = B_(T.toString('utf-8'))
            Cf(`Forwarding tool request from MCP client ${_}: ${z.method}`),
              LTH(
                CH({
                  type: 'tool_request',
                  method: z.method,
                  params: z.params,
                }),
              )
          } catch (z) {
            Cf(`Failed to parse tool request from MCP client ${_}:`, z)
          }
        }
      }),
      H.on('error', K => {
        Cf(`MCP client ${_} error: ${K}`)
      }),
      H.on('close', () => {
        Cf(
          `MCP client ${_} disconnected. Remaining clients: ${this.mcpClients.size - 1}`,
        ),
          this.mcpClients.delete(_),
          LTH(CH({ type: 'mcp_disconnected' }))
      })
  }
}
class G64 {
  buffer = Buffer.alloc(0)
  pendingResolve = null
  closed = !1
  constructor() {
    process.stdin.on('data', H => {
      ;(this.buffer = Buffer.concat([this.buffer, H])), this.tryProcessMessage()
    }),
      process.stdin.on('end', () => {
        if (((this.closed = !0), this.pendingResolve))
          this.pendingResolve(null), (this.pendingResolve = null)
      }),
      process.stdin.on('error', () => {
        if (((this.closed = !0), this.pendingResolve))
          this.pendingResolve(null), (this.pendingResolve = null)
      })
  }
  tryProcessMessage() {
    if (!this.pendingResolve) return
    if (this.buffer.length < 4) return
    let H = this.buffer.readUInt32LE(0)
    if (H === 0 || H > Fqq) {
      Cf(`Invalid message length: ${H}`),
        this.pendingResolve(null),
        (this.pendingResolve = null)
      return
    }
    if (this.buffer.length < 4 + H) return
    let _ = this.buffer.subarray(4, 4 + H)
    this.buffer = this.buffer.subarray(4 + H)
    let q = _.toString('utf-8')
    this.pendingResolve(q), (this.pendingResolve = null)
  }
  async read() {
    if (this.closed) return null
    if (this.buffer.length >= 4) {
      let H = this.buffer.readUInt32LE(0)
      if (H > 0 && H <= Fqq && this.buffer.length >= 4 + H) {
        let _ = this.buffer.subarray(4, 4 + H)
        return (this.buffer = this.buffer.subarray(4 + H)), _.toString('utf-8')
      }
    }
    return new Promise(H => {
      ;(this.pendingResolve = H), this.tryProcessMessage()
    })
  }
}
var nE,
  P64,
  Vh6,
  W64,
  gDO = '1.0.0',
  Fqq = 1048576,
  X64 = void 0,
  dDO
var L64 = R(() => {
  CZ()
  A6()
  i_()
  eC()
  ;(nE = require('fs/promises')),
    (P64 = require('net')),
    (Vh6 = require('os')),
    (W64 = require('path'))
  dDO = yH(() => x6.object({ type: x6.string() }).passthrough())
})
function cDO(H) {
  if (!H || !process.env.ANTHROPIC_UNIX_SOCKET) return H || {}
  let {
    ANTHROPIC_UNIX_SOCKET: _,
    ANTHROPIC_BASE_URL: q,
    ANTHROPIC_API_KEY: K,
    ANTHROPIC_AUTH_TOKEN: O,
    CLAUDE_CODE_OAUTH_TOKEN: T,
    ...z
  } = H
  return z
}
function k64() {
  Nh6 = {
    managedByHost:
      xH(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST) ||
      !!process.env.CLAUDE_CODE_HOST_AUTH_ENV_VAR,
    desktopHost: J$H(),
  }
}
function nDO(H, _) {
  if (!H) return {}
  if (!(Nh6.managedByHost || (Nh6.desktopHost && lDO.has(_)))) return H
  let K = {}
  for (let [O, T] of Object.entries(H)) if (!Zy7(O)) K[O] = T
  return K
}
function iDO(H) {
  if (!H || !vh6) return H || {}
  let _ = {}
  for (let [q, K] of Object.entries(H)) if (!vh6.has(q)) _[q] = K
  return _
}
function rDO(H) {
  if (!H) return {}
  let { NO_COLOR: _, FORCE_COLOR: q, ...K } = H
  if (_ !== void 0) i8_.NO_COLOR = _
  if (q !== void 0) i8_.FORCE_COLOR = q
  return K
}
function n8_(H, _) {
  return rDO(iDO(nDO(cDO(H), _)))
}
function wIH() {
  if ((k64(), vh6 === void 0))
    vh6 = Nh6.desktopHost ? new Set(Object.keys(process.env)) : null
  ;(i8_ = {}), Object.assign(process.env, n8_(b_().env, 'globalConfig'))
  for (let H of oDO) {
    if (H === 'policySettings') continue
    if (!AA(H)) continue
    Object.assign(process.env, n8_(S6(H)?.env, H))
  }
  Qo(),
    Object.assign(process.env, n8_(S6('policySettings')?.env, 'policySettings'))
  for (let H of uy()) {
    let _ = n8_(S6(H)?.env, H)
    for (let [q, K] of Object.entries(_))
      if (SrH.has(q.toUpperCase())) process.env[q] = K
  }
  l76(i8_)
}
function ys() {
  k64(), (i8_ = {}), Object.assign(process.env, n8_(b_().env, 'globalConfig'))
  for (let H of uy()) Object.assign(process.env, n8_(S6(H)?.env, H))
  l76(i8_), Nyq(), Syq(), wH8(), QO_()
}
var Nh6, lDO, vh6, i8_, oDO
var r8_ = R(() => {
  X$6()
  kpH()
  n6()
  Qn()
  c_()
  z$6()
  zp()
  MA()
  YT()
  M8()
  UN()
  Nh6 = { managedByHost: !1, desktopHost: !1 }
  lDO = new Set(['policySettings', 'projectSettings', 'localSettings'])
  i8_ = {}
  oDO = ['userSettings', 'flagSettings', 'policySettings']
})
var a8_ = {}
f_(a8_, {
  runFastPathPolicyHelper: () => yh6,
  resetFastPathPolicyForTesting: () => sDO,
  loadFastPathPolicy: () => aDO,
  ensureFastPathSettingsLoaded: () => V64,
})
async function V64() {
  if (gqq) return
  ;(gqq = !0), V4H(), await WpH(), wIH()
}
async function yh6() {
  if (o8_) return o8_.error
  if (((o8_ = { error: null }), (o8_.error = await vF_(p3_(), RpH())), m7H()))
    wIH()
  return o8_.error
}
async function aDO() {
  return await V64(), yh6()
}
function sDO() {
  ;(gqq = !1), (o8_ = null)
}
var gqq = !1,
  o8_ = null
var jIH = R(() => {
  n6()
  r8_()
  QUH()
  l$H()
  yZH()
  M8()
})
async function tDO() {
  let H = Z2H.join(O8H(), 'claude')
  if (!process.execPath.startsWith(Z2H.join(H, 'versions') + Z2H.sep))
    return null
  let _ = Z2H.join(H, 'ClaudeCode.app', 'Contents', 'MacOS'),
    q = Z2H.join(_, 'claude')
  try {
    let K = (await hs.stat(process.execPath)).ino
    try {
      if ((await hs.stat(q)).ino === K) return q
      await hs.unlink(q)
    } catch {}
    return (
      await hs.mkdir(_, { recursive: !0 }),
      await hs.writeFile(
        Z2H.join(_, '..', 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.anthropic.claude-code</string><key>CFBundleName</key><string>Claude Code</string><key>CFBundleDisplayName</key><string>Claude Code</string><key>CFBundleExecutable</key><string>claude</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>NSMicrophoneUsageDescription</key><string>Claude Code uses the microphone for voice dictation.</string></dict></plist>
`,
      ),
      await hs.link(process.execPath, q),
      q
    )
  } catch {
    return null
  }
}
async function N64() {
  if (n_() !== 'macos') return
  if (process.env.CLAUDE_BG_TCC_DISCLAIMED) {
    delete process.env.CLAUDE_BG_TCC_DISCLAIMED
    return
  }
  let H = (await tDO()) ?? process.execPath
  try {
    let _ = require('bun:ffi'),
      { symbols: q } = _.dlopen('/usr/lib/libSystem.B.dylib', {
        posix_spawnattr_init: { args: ['ptr'], returns: 'int' },
        posix_spawnattr_setflags: { args: ['ptr', 'i16'], returns: 'int' },
        posix_spawnattr_destroy: { args: ['ptr'], returns: 'int' },
        responsibility_spawnattrs_setdisclaim: {
          args: ['ptr', 'int'],
          returns: 'int',
        },
        posix_spawn: {
          args: ['ptr', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr'],
          returns: 'int',
        },
      }),
      K = new BigUint64Array(1)
    if (q.posix_spawnattr_init(K) !== 0) return
    try {
      if (
        q.posix_spawnattr_setflags(K, 64) !== 0 ||
        q.responsibility_spawnattrs_setdisclaim(K, 1) !== 0
      )
        return
      let T = [],
        z = J => {
          let M = Buffer.from(J + '\x00', 'utf8')
          return T.push(M), BigInt(_.ptr(M))
        },
        $ = J => {
          let M = new BigUint64Array(J.length + 1)
          return J.forEach((D, f) => (M[f] = z(D))), M
        },
        Y = hz() ? [H] : [H, process.argv[1]],
        A = Buffer.from(H + '\x00', 'utf8'),
        w = $([...Y, ...process.argv.slice(2)]),
        j = $(
          Object.entries({
            ...process.env,
            CLAUDE_BG_TCC_DISCLAIMED: '1',
          }).flatMap(([J, M]) => (M === void 0 ? [] : [`${J}=${M}`])),
        )
      q.posix_spawn(null, A, null, K, w, j)
    } finally {
      q.posix_spawnattr_destroy(K)
    }
  } catch {}
}
var hs, Z2H
var v64 = R(() => {
  $9()
  M3H()
  ;(hs = require('fs/promises')), (Z2H = require('path'))
})
var S64 = {}
f_(S64, { runPtyHost: () => HfO, createRing: () => E64 })
async function HfO(H) {
  let _ = H.indexOf('--')
  if (!H.includes('--bg-spare', _ + 1)) await N64()
  if (_ < 3 || _ === H.length - 1)
    return iy_(
      void 0,
      'bad argv: --bg-pty-host <sock> <cols> <rows> -- <file> [args...]',
    )
  let q = H[0]
  process.on('uncaughtException', k =>
    iy_(q, `uncaught: ${k?.stack ?? String(k)}`),
  ),
    process.on('unhandledRejection', k =>
      iy_(q, `unhandledRejection: ${k?.stack ?? String(k)}`),
    )
  let K = Number(H[1]) || 200,
    O = Number(H[2]) || 50,
    T = H[_ + 1],
    z = H.slice(_ + 2),
    $ = process.env.CLAUDE_PTY_HOST_EXEC === '1'
  if ((delete process.env.CLAUDE_PTY_HOST_EXEC, n_() !== 'windows'))
    try {
      hh6.setPriority(0, Math.min(hh6.getPriority(0) + 5, 19))
    } catch {}
  let Y = E64(EV_),
    A = new Set(),
    w = !1,
    j = !1,
    J = null,
    M = _fO(process.env.CLAUDE_PTY_RECORD, K, O)
  function D(k) {
    for (let v of A) {
      if (v.destroyed) {
        A.delete(v)
        continue
      }
      if (v.writableLength > eDO) {
        v.destroy(), A.delete(v)
        continue
      }
      v.write(k)
    }
  }
  let f, X
  try {
    ;(f = new Bun.Terminal({
      cols: K,
      rows: O,
      data(k, v) {
        j = !0
        let E = Buffer.from(v)
        if ((Y.push(E), M?.write(E), A.size)) D(SV_(E))
      },
    })),
      (X = Bun.spawn([T, ...z], {
        cwd: process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' },
        terminal: f,
        windowsHide: !0,
        detached: !1,
      }))
  } catch (k) {
    iy_(q, `spawn failed: ${String(k)}`)
  }
  function P(k, v) {
    if (!k.destroyed) k.write(v)
  }
  function G(k) {
    switch (k.t) {
      case 'resize': {
        let v = Number(k.cols),
          E = Number(k.rows)
        if (v > 0 && v <= JqH && E > 0 && E <= JqH && !w) {
          if ((f.resize(v, E), n_() !== 'windows'))
            try {
              process.kill(-process.pid, 'SIGWINCH')
            } catch {}
        }
        return
      }
      case 'kill': {
        let v = k.sig === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM'
        try {
          X.kill(v)
        } catch {}
        if (v === 'SIGTERM')
          setTimeout(() => {
            if (!w)
              try {
                X.kill('SIGKILL')
              } catch {}
          }, 5000).unref()
        return
      }
      default:
        return
    }
  }
  await Qqq.unlink(q).catch(() => {})
  let W = y64.createServer(k => {
    k.on('error', () => k.destroy()),
      k.once('close', () => A.delete(k)),
      P(
        k,
        CU({
          t: 'hello',
          replPid: X.pid,
          version: {
            ISSUES_EXPLAINER:
              'report the issue at https://github.com/anthropics/claude-code/issues',
            PACKAGE_URL: '@anthropic-ai/claude-code',
            README_URL: 'https://code.claude.com/docs/en/overview',
            VERSION: '2.1.153',
            FEEDBACK_CHANNEL:
              'https://github.com/anthropics/claude-code/issues',
            BUILD_TIME: '2026-05-27T20:03:21Z',
            GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
          }.VERSION,
        }),
      )
    for (let E of Y.chunks) P(k, SV_(E))
    if ((P(k, CU({ t: 'live' })), A.add(k), w)) {
      P(k, CU({ t: 'exit', code: Z, signal: L })), k.end()
      return
    }
    let v = KL6(
      E => {
        if (E.kind === gSH) {
          if (!w) {
            if ((f.write(E.payload), $ && n_() !== 'windows')) {
              let h = E.payload.includes(3)
                ? 'SIGINT'
                : E.payload.includes(28)
                  ? 'SIGQUIT'
                  : null
              if (h) {
                J = h
                try {
                  process.kill(-process.pid, h)
                } catch {}
                setImmediate(() => {
                  J = null
                })
              }
            }
          }
        } else if (E.kind === hV_) G(E.ctrl)
      },
      () => k.destroy(),
    )
    k.on('data', v)
  })
  W.on('error', k => {
    try {
      X.kill('SIGTERM')
    } catch {}
    iy_(q, `server error: ${String(k)}`)
  }),
    W.listen(q),
    W.unref()
  for (let k of ['SIGTERM', 'SIGINT', 'SIGHUP'])
    process.on(k, () => {
      if (J === k) return
      try {
        X.kill(k === 'SIGHUP' ? 'SIGTERM' : k)
      } catch {}
    })
  if ($ && n_() !== 'windows')
    process.on('SIGQUIT', () => {
      if (J === 'SIGQUIT') return
      try {
        X.kill('SIGQUIT')
      } catch {}
    })
  let Z = 0
  Z = await X.exited
  for (let k = 0; k < 20; k++) if (((j = !1), await r6(5), !j)) break
  let L = X.signalCode ?? void 0
  if (((w = !0), f.close(), M?.close(), $ && n_() !== 'windows')) {
    J = 'SIGHUP'
    try {
      process.kill(-process.pid, 'SIGHUP')
    } catch {}
  }
  if ((D(CU({ t: 'exit', code: Z, signal: L })), A.size === 0))
    await Promise.race([
      new Promise(k => W.once('connection', () => k())),
      r6(5000),
    ])
  for (let k of A) k.end()
  if (
    (await Promise.race([
      new Promise(k => W.close(() => k())),
      r6(2000, void 0, { unref: !0 }),
    ]),
    n_() !== 'windows')
  )
    await Qqq.unlink(q).catch(() => {})
  process.exit(Z)
}
function E64(H) {
  let _ = [],
    q = 0,
    K = 0
  function O() {
    if (q > 0) (_ = _.slice(q)), (q = 0)
  }
  return {
    get chunks() {
      return O(), _
    },
    push(T) {
      _.push(T), (K += T.length)
      while (K > H && _.length - q > 1) {
        K -= _[q++].length
        for (let z = 0; z < 3; ) {
          let $ = _[q],
            Y = 0
          while (z + Y < 3 && Y < $.length && ($[Y] & 192) === 128) Y++
          if (Y > 0) (_[q] = $.subarray(Y)), (K -= Y), (z += Y)
          if (_[q].length > 0 || _.length - q === 1) break
          q++
        }
      }
      if (q >= _.length - q) O()
    },
  }
}
function _fO(H, _, q) {
  if (!H) return
  let K = process.hrtime.bigint(),
    O
  try {
    O = s8_.createWriteStream(H, { flags: 'w' })
  } catch {
    return
  }
  O.on('error', () => {
    O?.destroy(), (O = void 0)
  })
  let T = Buffer.allocUnsafe(8)
  return (
    T.writeUInt32BE(_, 0),
    T.writeUInt32BE(q, 4),
    O.write(T),
    {
      write(z) {
        if (!O) return
        let $ = Buffer.allocUnsafe(8 + z.length),
          Y = Number((process.hrtime.bigint() - K) / 1000n)
        $.writeUInt32BE(Y >>> 0, 0),
          $.writeUInt32BE(z.length, 4),
          z.copy($, 8),
          O.write($)
      },
      close() {
        O?.end()
      },
    }
  )
}
function iy_(H, _) {
  if (H)
    try {
      let q = IE(H)
      s8_.mkdirSync(h64.dirname(q), { recursive: !0 }),
        s8_.writeFileSync(
          q,
          `${new Date().toISOString()} ${_}
`,
        )
    } catch {}
  process.exit(1)
}
var s8_,
  Qqq,
  y64,
  hh6,
  h64,
  eDO = 1048576
var C64 = R(() => {
  $9()
  v64()
  nv()
  QSH()
  ;(s8_ = require('fs')),
    (Qqq = require('fs/promises')),
    (y64 = require('net')),
    (hh6 = require('os')),
    (h64 = require('path'))
})
function b64(H, _) {
  return new Promise((q, K) => {
    let O = z => {
        T.close(), K(z)
      },
      T = I64.createServer(z => {
        let $ = ''
        z.setEncoding('utf8'),
          z.on('data', Y => {
            $ += Y
            let A = $.indexOf(`
`)
            if (A < 0) return
            T.close()
            try {
              q(B_($.slice(0, A)))
            } catch (w) {
              K(w)
            }
          }),
          z.on('error', O)
      })
    if ((T.on('error', O), _))
      T.once('listening', () => {
        try {
          _()
        } catch (z) {
          O(z)
        }
      })
    T.listen(H)
  })
}
async function x64(H, _) {
  let q = await x$(H.cwd)
  if ((process.chdir(q), Xy(q), g9H(q), Q9H(q), H.sessionId))
    KR(RX(H.sessionId))
  Xx6(),
    nlK(),
    Object.assign(process.env, H.env),
    (process.argv = [process.argv[0], process.argv[1], ...H.argv])
  let { main: K } = await _
  await K()
}
var I64
var u64 = R(() => {
  J_()
  cP()
  nj()
  i_()
  q2H()
  I64 = require('net')
})
function dqq(H) {
  let _ = '',
    q = '',
    K = !0,
    O = 0,
    T = '',
    z = !1
  function $(A, w) {
    let j = D1(q).slice(0, Eh6),
      J = `${A}|${w}|${j}`
    if (J === T) return
    ;(T = J),
      o7(H)
        .then(M =>
          M && !z
            ? iO(H, {
                ...M,
                state: A,
                tempo: w,
                detail: j,
                updatedAt: new Date().toISOString(),
              })
            : void 0,
        )
        .catch(hH)
  }
  let Y = setInterval(() => {
    if (O === 0) return
    if (Date.now() - O < m64) $('working', 'active')
    else if (!K && q) $('blocked', 'blocked')
    else $('working', 'idle')
  }, m64)
  return (
    Y.unref(),
    {
      feed(A) {
        let w = D5(A.replace(qfO, '\x00'))
          .replace(
            /\r\n?/g,
            `
`,
          )
          .replace(/\0+$/, '')
          .replace(
            /\0/g,
            `
`,
          )
        if (!w) return
        ;(O = Date.now()), (_ += w)
        let j = _.split(`
`)
        if (
          ((_ = j.pop() ?? ''),
          (K = _ === ''),
          (q = _.trim() || j.findLast(M => M.trim())?.trim() || q),
          _.length > Eh6 * 2)
        )
          _ = _.slice(-Eh6)
        if (T.startsWith('blocked|')) $('working', 'active')
      },
      dispose() {
        ;(z = !0), clearInterval(Y)
      },
      get lastLine() {
        return D1(q).slice(0, Eh6)
      },
    }
  )
}
var m64 = 2000,
  Eh6 = 120,
  qfO
var p64 = R(() => {
  YY()
  W6()
  oW()
  qfO = /\x1b\[\d*D/g
})
function Ch6(H, _, q, K, O) {
  let T = C7(),
    z = C7(),
    $,
    Y = new Q64.StringDecoder('utf8'),
    A,
    w = !1,
    j = !1,
    J = 0,
    M = 0,
    D,
    f,
    X,
    P,
    G = 0,
    W,
    Z = !1,
    L = !1,
    k = !1,
    v = q
  if (v === void 0)
    ey(_, { skipCache: !0 }).then(g => {
      v = g
    })
  let E = [],
    h = 0
  function C(g) {
    if (A) {
      if (A.destroyed) return !1
      if (!A.write(g)) {
        if (!X)
          (X = setTimeout(() => {
            ;(X = void 0), A?.destroy()
          }, OfO)),
            X.unref()
        if (!P && A.writableLength > F64)
          (P = setTimeout(() => {
            if (((P = void 0), A && !A.destroyed && A.writableLength > F64))
              I(), A.destroy()
          }, TfO)),
            P.unref()
      }
      return !0
    }
    if (h < 2 * W__) E.push(g), (h += g.length)
    return !1
  }
  function I() {
    if (X) clearTimeout(X), (X = void 0)
    if (P) clearTimeout(P), (P = void 0)
  }
  function b(g, Q) {
    if (j) return
    if (((j = !0), (w = !0), f)) clearTimeout(f), (f = void 0)
    I(), A?.destroy(), (A = void 0)
    let l = Y.end()
    if (l) T.emit(l)
    z.emit({ exitCode: g, signal: Q })
  }
  function m(g) {
    if (
      (Sh6.readFile(IE(H), 'utf8')
        .then(Q => {
          return N(`[bg-pty] host crash: ${Q.trim()}`, { level: 'warn' }), !0
        })
        .catch(() => !1)
        .then(Q =>
          c('tengu_bg_ptyhost_crash', {
            hadBreadcrumb: Q,
            hadHello: Z,
            via: g,
            short: K,
          }),
        ),
      LGH(G ? [-_, G] : [-_], g !== 'hung' ? void 0 : v),
      O)
    ) {
      O.exited.then(
        Q => b(Q, O.signalCode ?? void 0),
        () => b(-1),
      ),
        setTimeout(b, 1000, -1).unref()
      return
    }
    b(-1)
  }
  function S(g) {
    if (g.kind === gSH) {
      if (!L) T.emit(Y.write(g.payload))
    } else if (g.ctrl.t === 'hello') {
      if (Z) (L = !0), Y.end()
      ;(Z = !0), (G = g.ctrl.replPid), (W = g.ctrl.version)
    } else if (g.ctrl.t === 'live') {
      if (L) (L = !1), $?.()
    } else if (g.ctrl.t === 'exit') b(g.ctrl.code, g.ctrl.signal)
  }
  function x() {
    if (w) return
    let g = new g64.Socket(),
      Q = !1
    g.on('error', l => {
      ;(k = f6(l) === 'ENOENT'), U()
    }),
      g.once('close', () => {
        if (A === g) (A = void 0), I()
        if (w) return
        if (Q && !j) {
          try {
            process.kill(_, 0),
              N('[bg-pty] dropped by host; reconnecting', { level: 'debug' }),
              (M = KfO),
              (J = 0),
              U()
            return
          } catch {}
          m('close')
          return
        }
        U()
      }),
      g.once('connect', () => {
        ;(Q = !0),
          (J = 0),
          (M = 0),
          (A = g),
          g.on('drain', I),
          Sh6.unlink(IE(H)).catch(() => {})
        for (let d of E.splice(0)) C(d)
        h = 0
        let l = KL6(S, d => {
          N(`[bg-pty] frame error: ${d}`, { level: 'warn' }), g.destroy()
        })
        g.on('data', l)
      }),
      g.connect(H)
  }
  function U() {
    if (w || D) return
    try {
      process.kill(_, 0)
    } catch {
      m('connect')
      return
    }
    if (M > 0 && --M === 0) {
      m('hung')
      return
    }
    if (q !== void 0 && k && J >= 3)
      N(
        `[bg-pty] ${H}: ENOENT on adopt \u2014 sock file externally deleted; respawning`,
        { level: 'warn' },
      ),
        c('tengu_bg_adopt_sock_unlinked', {}),
        (J = U64)
    if (J >= U64) {
      N(`[bg-pty] ${H}: ${J} connect attempts failed; treating host as dead`, {
        level: 'warn',
      })
      let Q = v && VKH(_)
      if (!v || !Q || v === Q)
        try {
          process.kill(-_, 'SIGKILL')
        } catch {
          try {
            process.kill(_, 'SIGKILL')
          } catch {}
        }
      b(-1)
      return
    }
    let g = B64[Math.min(J, B64.length - 1)]
    J++,
      (D = setTimeout(() => {
        ;(D = void 0), x()
      }, g)),
      D.unref()
  }
  return (
    x(),
    {
      pid: _,
      replPid: () => G,
      replVersion: () => W,
      onResume: g => {
        $ = g
      },
      write: g => {
        if (j) return
        let Q = Buffer.from(g, 'utf8'),
          l = W__ - 1
        for (let d = 0; d < Q.length; d += l) C(SV_(Q.subarray(d, d + l)))
      },
      resize: (g, Q) => C(CU({ t: 'resize', cols: g, rows: Q })),
      kill: g => {
        let Q = g === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM',
          l = C(CU({ t: 'kill', sig: Q }))
        if (n_() === 'windows' && Q === 'SIGTERM' && l) {
          if (f) clearTimeout(f)
          ;(f = setTimeout(
            (d, r) => {
              if (!zz_(d, v)) {
                r(-1)
                return
              }
              try {
                process.kill(d, 'SIGKILL')
              } catch {
                r(-1)
              }
            },
            5000,
            _,
            b,
          )),
            f.unref()
          return
        }
        try {
          process.kill(-_, Q)
        } catch {
          try {
            process.kill(_, Q)
          } catch {
            b(-1)
          }
        }
        if (Q === 'SIGTERM' && !j) {
          if (f) clearTimeout(f)
          ;(f = setTimeout(
            (d, r) => {
              if (!zz_(d, v)) {
                r(-1)
                return
              }
              try {
                process.kill(-d, 'SIGKILL')
              } catch {
                try {
                  process.kill(d, 'SIGKILL')
                } catch {
                  r(-1)
                }
              }
            },
            5000,
            _,
            b,
          )),
            f.unref()
        }
      },
      dispose: () => {
        if (((w = !0), D)) clearTimeout(D), (D = void 0)
        if (f) clearTimeout(f), (f = void 0)
        I(), A?.destroy(), (A = void 0)
      },
      onData: g => ({ dispose: T.subscribe(g) }),
      onExit: g => ({ dispose: z.subscribe(g) }),
    }
  )
}
var Sh6,
  g64,
  Q64,
  B64,
  U64 = 30,
  KfO = 4,
  OfO = 1e4,
  F64,
  TfO = 50
var d64 = R(() => {
  N_()
  lH()
  W_()
  OX()
  $9()
  $A()
  nv()
  QSH()
  ;(Sh6 = require('fs/promises')),
    (g64 = require('net')),
    (Q64 = require('string_decoder')),
    (B64 = [50, 100, 250, 500, 1000, 2000]),
    (F64 = 8 * W__)
})
function i64(H, _, q, K) {
  let O,
    T = !1,
    z = 0,
    $ = !1,
    Y
  function A() {
    if (T) return
    let j = new n64.Socket(),
      J = !1
    j.on('error', () => w()),
      j.once('close', () => {
        if (O === j) O = void 0
        if (T) return
        if (J) q()
        w()
      }),
      j.once('connect', () => {
        ;(J = !0),
          (z = 0),
          ($ = !1),
          (O = j),
          K?.(),
          j.write(
            CH({ proto: P5, role: 'supervisor', supervisorPid: process.pid }) +
              `
`,
          ),
          rL6(j, M => {
            let D
            try {
              D = B_(M)
            } catch {
              return
            }
            if (D && typeof D === 'object' && 'type' in D) _(D)
          })
      }),
      j.connect(H)
  }
  function w() {
    if (T || Y || $) return
    if (z >= l64) {
      ;($ = !0),
        N(
          `[bg-rv] ${H}: ${z} connect attempts failed \u2014 giving up (pid-poll is liveness backstop)`,
          { level: 'warn' },
        ),
        c('tengu_bg_rv_connect_exhausted', { attempts: z })
      return
    }
    let j = c64[Math.min(z, c64.length - 1)]
    z++,
      (Y = setTimeout(() => {
        ;(Y = void 0), A()
      }, j)),
      Y.unref()
  }
  return (
    A(),
    {
      send(j) {
        if (!O || O.destroyed) {
          if (z >= l64) (z = 0), ($ = !1), w()
          return !1
        }
        try {
          return (
            O.write(
              CH(j) +
                `
`,
            ),
            !0
          )
        } catch (J) {
          return N(`[bg-rv] send failed: ${String(J)}`), !1
        }
      },
      close() {
        if (((T = !0), Y)) clearTimeout(Y)
        O?.destroy(), (O = void 0)
      },
    }
  )
}
var n64,
  c64,
  l64 = 30
var r64 = R(() => {
  N_()
  lH()
  i_()
  fo8()
  cv()
  ;(n64 = require('net')), (c64 = [100, 250, 500, 1000, 2000])
})
function nqq() {
  return (H, _, q) => {
    let { cmd: K, prefixArgs: O } = WE({ pinToCurrentBinary: !0 }),
      T = Bun.spawn(
        [
          K,
          ...O,
          '--bg-pty-host',
          q.ptySock,
          String(q.cols),
          String(q.rows),
          '--',
          H,
          ..._,
        ],
        {
          cwd: q.cwd,
          env: q.env,
          stdio: ['ignore', 'ignore', 'ignore'],
          detached: !0,
          windowsHide: !0,
        },
      )
    return T.unref(), Ch6(q.ptySock, T.pid, void 0, q.short, T)
  }
}
function e64(H, _, q, K, O) {
  if (H.launch.mode === 'exec') return H.launch.args
  if (_ > 1 && q) return ['--resume', K, ...O]
  if (H.launch.mode === 'resume')
    return [
      ...(H.launch.fork ? ['--session-id', H.sessionId, '--fork-session'] : []),
      '--resume',
      H.launch.sessionId,
      ...H.launch.flagArgs,
    ]
  return H.launch.args
}
function H84(H, _, q, K) {
  let O = {
    ...process.env,
    ...(q && { CLAUDE_BG_AUTH_SNAPSHOT_PATH: q }),
    ...(n_() === 'windows' && { CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT: '1' }),
    ...H.env,
    CLAUDE_CODE_SESSION_KIND: 'bg',
    CLAUDE_BG_BACKEND: 'daemon',
    CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
    CLAUDE_BG_SOURCE: H.source,
    CLAUDE_JOB_DIR: _,
    CLAUDE_CODE_SESSION_NAME: H.seed?.name || H.seed?.intent || H.short,
    CLAUDE_BG_RENDEZVOUS_SOCK: K,
    FORCE_COLOR: '3',
    COLORTERM: 'truecolor',
    BROWSER: 'true',
  }
  if (process.env.CLAUDE_CONFIG_DIR)
    O.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR
  if (H.isolation === 'worktree') O.CLAUDE_BG_ISOLATION = 'worktree'
  for (let T of rqq) if (!H.env?.[T]) delete O[T]
  if (q) delete O.CLAUDE_CODE_OAUTH_TOKEN
  if (H.launch.mode === 'exec') {
    for (let T of Object.keys(O))
      if (
        (T.startsWith('CLAUDE_') &&
          T !== 'CLAUDE_JOB_DIR' &&
          T !== 'CLAUDE_CONFIG_DIR') ||
        T.startsWith('OTEL_')
      )
        delete O[T]
    delete O.BROWSER, (O.CLAUDE_PTY_HOST_EXEC = '1')
  }
  return O
}
async function iqq(H, _) {
  if (!_ || n_() !== 'macos') return
  let q = tV_(H)
  try {
    return (
      await sqH.mkdir(Zo8(), { recursive: !0, mode: 448 }),
      await sqH.writeFile(q, JSON.stringify(_), { mode: 384 }),
      q
    )
  } catch (K) {
    N(`writeAuthSnapshot failed: ${LH(K)}`, { level: 'warn' })
    return
  }
}
function _84(H) {
  return H.kind === 'retiring'
    ? `retiring:${H.reason}`
    : H.kind === 'retired'
      ? `retired:${H.outcome}`
      : H.kind
}
function jfO(H, _) {
  if (H.kind === 'retired') return !1
  switch (_.kind) {
    case 'spawning':
      return H.kind === 'upgrading' || H.kind === 'running'
    case 'running':
      return H.kind === 'spawning'
    case 'upgrading':
      return H.kind === 'running'
    case 'retiring':
      return !0
    case 'retired':
      return !0
  }
}
class zF {
  dispatch
  spawnPty
  getAuthSnapshot
  via
  record
  onStream = C7()
  onState = C7()
  onSettle = C7()
  onRepaintDone = C7()
  attachers = new Map()
  pty
  procStart
  ptyCols = 200
  ptyRows = 50
  decModes = fy_()
  execTracker
  execLastLine
  offData
  offExit
  ring = []
  ringBytes = 0
  ringSpawnMark = 0
  attempt = 0
  lastSpawnAt = 0
  fastCrashStreak = 0
  lastExitCause
  backoffTimer = null
  pidPoll = null
  rv
  rvSockPath
  ptySockPath
  unverifiedSock
  phase = { kind: 'spawning' }
  workerReady = !1
  resizeDeferred = !1
  lastInputAt
  deleteJobDirOnSettle = !1
  get shouldDeleteJobDir() {
    return this.deleteJobDirOnSettle
  }
  adoptedAt
  lastRvHeartbeat
  stalledLogged = !1
  lastCheckPidAt = Date.now()
  replyChain = Promise.resolve()
  killOutcome = 'killed'
  get isKilling() {
    return this.phase.kind === 'retiring' && this.phase.reason === 'reap'
  }
  get isRetiring() {
    return this.phase.kind === 'retiring' && this.phase.reason === 'grace'
  }
  get isUnverified() {
    return this.unverifiedSock !== void 0
  }
  getPhase() {
    return this.phase
  }
  get isTransitioning() {
    return this.phase.kind !== 'running' || !this.pty || this.record.pid === 0
  }
  get isDetached() {
    return this.phase.kind === 'retiring' && this.phase.reason === 'stop'
  }
  transitionTo(H) {
    if (!jfO(this.phase, H))
      return (
        N(
          `[bg] illegal worker-phase transition ${_84(this.phase)} \u2192 ${_84(H)} for ${this.record.short}`,
          { level: 'warn' },
        ),
        c('tengu_bg_phase_illegal', {}),
        !1
      )
    return (this.phase = H), !0
  }
  shutdownWorker() {
    let H = this.rv?.send({ type: 'shutdown' }) ?? !1
    if (!H) this.sigtermWorker()
    else
      setTimeout(
        _ => {
          let q = _.phase
          if (
            (q.kind === 'upgrading' ||
              (q.kind === 'retiring' && q.reason === 'grace')) &&
            !_.record.outcome
          )
            _.sigtermWorker()
        },
        5000,
        this,
      ).unref()
    return H
  }
  async respawnIfIdleStale(H) {
    if (this.dispatch.launch.mode === 'exec')
      return { respawned: !1, reason: 'not-stale' }
    if (this.isTransitioning) return { respawned: !1, reason: 'in-progress' }
    if (this.record.outcome) return { respawned: !1, reason: 'no-state' }
    if (this.attachers.size > 0) return { respawned: !1, reason: 'attached' }
    let _ = await o7(b4(this.dispatch.short))
    if (this.isTransitioning) return { respawned: !1, reason: 'in-progress' }
    if (this.record.outcome) return { respawned: !1, reason: 'no-state' }
    if (this.attachers.size > 0) return { respawned: !1, reason: 'attached' }
    if (!_) return { respawned: !1, reason: 'no-state' }
    if (HD(_) && !H?.has(this.dispatch.short))
      return { respawned: !1, reason: 'settled' }
    if (
      !_.cliVersion ||
      _.cliVersion ===
        {
          ISSUES_EXPLAINER:
            'report the issue at https://github.com/anthropics/claude-code/issues',
          PACKAGE_URL: '@anthropic-ai/claude-code',
          README_URL: 'https://code.claude.com/docs/en/overview',
          VERSION: '2.1.153',
          FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
          BUILD_TIME: '2026-05-27T20:03:21Z',
          GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
        }.VERSION
    )
      return { respawned: !1, reason: 'not-stale' }
    if (!HD(_) && _.tempo !== 'idle') return { respawned: !1, reason: 'busy' }
    if (!this.transitionTo({ kind: 'upgrading' }))
      return { respawned: !1, reason: 'in-progress' }
    return (
      this.onState.emit({ pid: this.record.pid }),
      c('tengu_bg_respawn_stale', {
        short: this.dispatch.short,
        rvSent: this.shutdownWorker(),
      }),
      { respawned: !0 }
    )
  }
  async retireIfSettled(H, _, q = H) {
    if (this.isTransitioning) return { retired: !1, reason: 'in-progress' }
    if (this.record.outcome) return { retired: !1, reason: 'no-state' }
    if (this.attachers.size > 0) return { retired: !1, reason: 'attached' }
    if (_?.has(this.dispatch.short)) return { retired: !1, reason: 'pinned' }
    if (this.adoptedAt && Date.now() - this.adoptedAt < AfO)
      return { retired: !1, reason: 'recent-adopt' }
    if (this.lastInputAt && Date.now() - this.lastInputAt < H)
      return { retired: !1, reason: 'recent-input' }
    let K = await o7(b4(this.dispatch.short))
    if (this.isTransitioning || this.attachers.size > 0)
      return { retired: !1, reason: 'in-progress' }
    if (this.lastInputAt && Date.now() - this.lastInputAt < H)
      return { retired: !1, reason: 'recent-input' }
    if (!K) {
      if (
        this.dispatch.source === 'spare' &&
        Date.now() - this.dispatch.createdAt > H
      ) {
        if (!this.transitionTo({ kind: 'retiring', reason: 'grace' }))
          return { retired: !1, reason: 'in-progress' }
        return (
          c('tengu_bg_retired', {
            short: this.dispatch.short,
            rvSent: this.shutdownWorker(),
            settledForMs: Date.now() - this.dispatch.createdAt,
            state: 'stale-spare',
          }),
          { retired: !0 }
        )
      }
      return { retired: !1, reason: 'no-state' }
    }
    if (
      this.dispatch.source !== 'shell' &&
      !K.name &&
      !K.intent &&
      !K.worktreePath &&
      K.template === 'bg' &&
      K.state === 'working' &&
      K.tempo === 'blocked'
    ) {
      let z = Date.now() - Date.parse(K.createdAt)
      if (z < wfO) return { retired: !1, reason: 'empty-idle-grace' }
      if (!this.transitionTo({ kind: 'retiring', reason: 'grace' }))
        return { retired: !1, reason: 'in-progress' }
      return (
        (this.deleteJobDirOnSettle = !0),
        c('tengu_bg_retired', {
          short: this.dispatch.short,
          rvSent: this.shutdownWorker(),
          settledForMs: z,
          state: 'empty-idle',
        }),
        { retired: !0 }
      )
    }
    if (!HD(K)) return { retired: !1, reason: 'not-settled' }
    if ((K.inFlight?.tasks ?? 1) > 0 || (K.inFlight?.queued ?? 1) > 0)
      return { retired: !1, reason: 'inflight' }
    if (K.inFlight?.kinds.includes('session_cron'))
      return { retired: !1, reason: 'session-cron' }
    if (K.routine) return { retired: !1, reason: 'routine' }
    let O = K.bridgeSessionId ? Math.max(H, q) : H,
      T = K.updatedAt && Date.now() - Date.parse(K.updatedAt)
    if (!T || T < O) return { retired: !1, reason: 'grace' }
    if (!this.transitionTo({ kind: 'retiring', reason: 'grace' }))
      return { retired: !1, reason: 'in-progress' }
    return (
      c('tengu_bg_retired', {
        short: this.dispatch.short,
        rvSent: this.shutdownWorker(),
        settledForMs: T,
        bridged: !!K.bridgeSessionId,
        state: K.state,
      }),
      { retired: !0 }
    )
  }
  sigtermWorker() {
    try {
      this.pty?.kill('SIGTERM')
    } catch {}
  }
  constructor(H, _, q, K, O) {
    this.dispatch = H
    this.spawnPty = _
    this.getAuthSnapshot = q
    this.via = K
    if (
      ((this.record = {
        short: H.short,
        nonce: H.nonce,
        sessionId: H.sessionId,
        pid: 0,
        attempt: 0,
        startedAt: Date.now(),
        cwd: H.cwd,
        backend: 'daemon',
        tempo: 'active',
        state: 'starting',
        detail: '',
        intent: H.seed?.intent ?? '',
        name: H.seed?.name,
        agent: H.agent,
        routine: H.routine,
        worktreePath: H.worktree?.path,
        cliVersion: {
          ISSUES_EXPLAINER:
            'report the issue at https://github.com/anthropics/claude-code/issues',
          PACKAGE_URL: '@anthropic-ai/claude-code',
          README_URL: 'https://code.claude.com/docs/en/overview',
          VERSION: '2.1.153',
          FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
          BUILD_TIME: '2026-05-27T20:03:21Z',
          GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
        }.VERSION,
        source: H.source,
        ...O,
      }),
      H.cols)
    )
      this.ptyCols = H.cols
    if (H.rows) this.ptyRows = H.rows
  }
  static spawn(H, _, q, K) {
    let O = new zF(H, _ ?? nqq(), q, 'cold')
    if (K?.afterUpgrade)
      return (
        (O.attempt = 1),
        O.buildBridgeReattachEnvFromState().then(T => O.doSpawn(T)),
        O
      )
    return O.doSpawn(H.reattachEnv), O
  }
  static claim(H, _) {
    let q = new zF(H, _.spawnPty, _.getAuthSnapshot, 'spare', {
      pid: _.pid,
      attempt: 1,
      state: 'running',
      cliVersion: {
        ISSUES_EXPLAINER:
          'report the issue at https://github.com/anthropics/claude-code/issues',
        PACKAGE_URL: '@anthropic-ai/claude-code',
        README_URL: 'https://code.claude.com/docs/en/overview',
        VERSION: '2.1.153',
        FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
        BUILD_TIME: '2026-05-27T20:03:21Z',
        GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
      }.VERSION,
    })
    return (
      (q.attempt = 1),
      (q.ptySockPath = _.ptySockPath),
      (q.rvSockPath = x__(H.short)),
      q.wirePty(Ch6(_.ptySockPath, _.pid, void 0, H.short)),
      q.resize(H.cols ?? 200, H.rows ?? 50),
      q.connectRv(),
      ey(_.pid, { skipCache: !0 }).then(K => {
        if (q.record.pid !== _.pid || q.isDetached || q.record.outcome) return
        if (K) q.procStart = K
        q.patch({ pid: _.pid })
      }),
      q
    )
  }
  static buildClaimFrame(H, _) {
    let q = b4(H.short),
      K = H84(H, q, _, x__(H.short))
    if (H.reattachEnv) Object.assign(K, H.reattachEnv)
    let O = e64(H, 1, !1, H.sessionId, H.respawnFlags)
    return { env: K, argv: O }
  }
  static async adopt(H, _, q, K) {
    try {
      process.kill(_.pid, 0)
    } catch (z) {
      let $ = f6(z)
      if ($ === 'ESRCH' || $ === 'EPERM') return null
    }
    let O = await ey(_.pid)
    if (O && _.procStart !== O) return null
    let T = new zF(_.dispatch, q, K, 'adopted', {
      pid: _.pid,
      attempt: _.attempt,
      startedAt: _.startedAt,
      messagingSock: _.messagingSock,
      state: 'adopted',
      detail: 'adopted from previous supervisor',
      cliVersion: _.cliVersion,
      ...(_.ptySock ? {} : { legacy: !0 }),
    })
    if (
      ((T.attempt = _.attempt),
      (T.procStart = _.procStart),
      (T.workerReady = !0),
      (T.adoptedAt = Date.now()),
      (T.rvSockPath = _.rendezvousSock),
      (T.ptySockPath = _.ptySock),
      T.dispatch.launch.mode === 'exec')
    )
      (T.execTracker = dqq(b4(T.dispatch.short))), (T.workerReady = !0)
    if (_.ptySock)
      T.wirePty(Ch6(_.ptySock, _.pid, T.procStart, T.dispatch.short)),
        (T.ptyCols = 0),
        T.seedFocus(!1)
    if (_.decModes) T.decModes.seed(_.decModes)
    if ((T.connectRv(), _.pendingRespawn === 'upgrade'))
      T.transitionTo({ kind: 'upgrading' }),
        setTimeout(
          z => {
            if (z.phase.kind === 'upgrading' && !z.record.outcome)
              z.sigtermWorker()
          },
          5000,
          T,
        ).unref()
    return T
  }
  static unverified(H, _) {
    let q = new zF(_.dispatch, void 0, void 0, 'adopted', {
      pid: _.pid,
      attempt: _.attempt,
      startedAt: _.startedAt,
      messagingSock: _.messagingSock,
      state: 'adopted',
      detail: 'adopted (pid unverifiable; tracking via pty.sock)',
      cliVersion: _.cliVersion,
    })
    return (
      (q.attempt = _.attempt),
      (q.procStart = _.procStart),
      (q.rvSockPath = _.rendezvousSock),
      (q.ptySockPath = _.ptySock),
      (q.unverifiedSock = _.ptySock),
      (q.lastInputAt = Date.now()),
      (q.pidPoll = setInterval(
        K => {
          if (K.record.outcome || !K.unverifiedSock) return
          Jy6(K.unverifiedSock).then(O => {
            if (O || K.record.outcome || K.phase.kind !== 'spawning') return
            K.settle('crashed')
          })
        },
        cqq,
        q,
      )),
      q.pidPoll.unref(),
      c('tengu_bg_adopt_unverified', { short: H }),
      q
    )
  }
  tail(H) {
    return H > 0 ? this.ring.slice(-H) : []
  }
  ringSnapshot() {
    return this.ring
  }
  preInitErrorTail() {
    let H = D5(this.ring.slice(this.ringSpawnMark).join(''))
      .replace(/\s+/g, ' ')
      .trim()
    if (!H) return
    return H.length > s64 ? `\u2026${H.slice(-s64)}` : H
  }
  decModeSnapshot() {
    return this.decModes.snapshot()
  }
  write(H) {
    ;(this.lastInputAt = Date.now()), this.pty?.write(H)
  }
  noteActivity() {
    this.lastInputAt = Date.now()
  }
  shiftGraceClocksForward(H) {
    if (H <= 0) return
    if (this.adoptedAt !== void 0) this.adoptedAt += H
    if (this.lastInputAt !== void 0) this.lastInputAt += H
  }
  seedFocus(H) {
    if (this.dispatch.launch.mode === 'exec') return
    this.pty?.write(H ? iLH : rLH)
  }
  resize(H, _) {
    if (
      ((this.ptyCols = H),
      (this.ptyRows = _),
      n_() === 'windows' && !this.workerReady)
    ) {
      this.resizeDeferred = !0
      return
    }
    try {
      this.pty?.resize(H, _)
    } catch {}
  }
  signalPtyPgrp() {
    if (n_() === 'windows' || !this.record.pid) return
    setTimeout(
      H => {
        try {
          process.kill(-H, 'SIGWINCH')
        } catch {}
      },
      15,
      this.record.pid,
    )
  }
  resizeForRepaint(H, _) {
    if (H !== this.ptyCols || _ !== this.ptyRows)
      return (
        this.resize(H, _),
        this.signalPtyPgrp(),
        this.rv?.send({ type: 'repaint' }),
        () => {}
      )
    let q = this.rv?.send({ type: 'repaint' }) === !0,
      K = () => {},
      O = setTimeout(
        (T, z) => {
          if ((K(), this.ptyCols !== T || this.ptyRows !== z)) return
          let $ = Math.max(2, T - 1)
          this.resize($, z),
            this.signalPtyPgrp(),
            setTimeout(
              (Y, A, w) => {
                if (this.ptyCols === w && this.ptyRows === A)
                  this.resize(Y, A), this.signalPtyPgrp()
              },
              30,
              T,
              z,
              $,
            )
        },
        q ? 50 : 0,
        H,
        _,
      )
    if (q)
      K = this.onRepaintDone.subscribe(() => {
        K(), clearTimeout(O)
      })
    return () => {
      K(), clearTimeout(O)
    }
  }
  rosterEntry() {
    return {
      pid: this.record.pid,
      procStart: this.procStart,
      sessionId: this.record.sessionId,
      rendezvousSock: this.rvSockPath ?? x__(this.dispatch.short),
      ptySock: this.record.legacy
        ? void 0
        : (this.ptySockPath ?? BU(this.dispatch.short)),
      messagingSock: this.record.messagingSock,
      cliVersion: this.record.cliVersion,
      startedAt: this.record.startedAt,
      attempt: this.attempt,
      cwd: this.dispatch.cwd,
      worktreePath: this.dispatch.worktree?.path,
      dispatch: this.cappedDispatch(),
      pendingRespawn: this.phase.kind === 'upgrading' ? 'upgrade' : void 0,
      decModes: this.decModes.snapshot(),
    }
  }
  cappedDispatch() {
    return JSON.parse(
      JSON.stringify(this.dispatch, (H, _) =>
        H === 'reattachEnv' || H === 'attachStallRespawns'
          ? void 0
          : typeof _ === 'string' && _.length > t64
            ? _.slice(0, t64)
            : _,
      ),
    )
  }
  async reply(H) {
    if (
      ((this.lastInputAt = Date.now()),
      ((await o7(b4(this.dispatch.short)))?.tempo ?? this.record.tempo) ===
        'blocked' && this.rv?.send({ type: 'reply', text: H }))
    )
      return !0
    if (this.pty) {
      let q = this.dispatch.launch.mode !== 'exec'
      return (
        (this.replyChain = this.replyChain.then(
          () =>
            new Promise(K => {
              this.pty?.write(q ? `\x1B[200~${H}\x1B[201~` : H),
                setTimeout(
                  O => {
                    this.pty?.write('\r'), O()
                  },
                  10,
                  K,
                )
            }),
        )),
        !0
      )
    }
    return this.rv?.send({ type: 'reply', text: H }) ?? !1
  }
  sendAttacherCaps(H) {
    return this.rv?.send({ type: 'attacher-caps', caps: H }) ?? !1
  }
  kill(H = 'SIGTERM', _ = 'killed', q) {
    if (this.phase.kind === 'retired') return
    if (((this.killOutcome = _), q)) this.patch({ detail: q })
    if (
      (this.transitionTo({ kind: 'retiring', reason: 'reap' }),
      this.backoffTimer)
    )
      clearTimeout(this.backoffTimer), (this.backoffTimer = null)
    if (this.unverifiedSock) {
      aCH(this.unverifiedSock).finally(() => this.settle(this.killOutcome))
      return
    }
    if (this.pty)
      try {
        this.pty.kill(H)
      } catch {}
    else if (this.record.pid && !this.pidRecycled())
      try {
        process.kill(-this.record.pid, H)
      } catch {
        try {
          process.kill(this.record.pid, H)
        } catch {}
      }
    if (!this.pty) this.settle(this.killOutcome)
  }
  stop() {
    if (this.phase.kind === 'retiring' && this.phase.reason === 'reap')
      this.settle(this.killOutcome)
    else if (this.phase.kind === 'retiring' && this.phase.reason === 'grace')
      this.settle('done')
    else if (this.phase.kind !== 'retired')
      this.transitionTo({ kind: 'retiring', reason: 'stop' })
    if (this.backoffTimer)
      clearTimeout(this.backoffTimer), (this.backoffTimer = null)
    this.clearLiveness(),
      this.offData?.dispose(),
      this.offExit?.dispose(),
      this.execTracker?.dispose(),
      (this.execTracker = void 0),
      this.pty?.dispose(),
      (this.pty = void 0)
  }
  async doSpawn(H) {
    this.attempt++,
      (this.workerReady = !1),
      (this.resizeDeferred = !1),
      (this.ringSpawnMark = this.ring.length),
      (this.lastSpawnAt = Date.now())
    let _ = this.dispatch,
      q = b4(_.short)
    await sqH.mkdir(q, { recursive: !0 }).catch(() => {})
    let K =
        _.launch.mode === 'exec'
          ? void 0
          : await iqq(_.short, this.getAuthSnapshot?.()),
      O = _.launch.mode === 'resume' ? _.launch.sessionId : void 0,
      T = !1,
      z = !1,
      $ = _.sessionId,
      Y = _.respawnFlags
    if (this.attempt > 1) {
      let D = await o7(q)
      ;($ = D?.resumeSessionId ?? _.sessionId),
        (Y = D?.respawnFlags ?? _.respawnFlags)
      let f = await x$(_.cwd),
        X = lqq.join(_0(f), `${$}.jsonl`)
      if (
        ((T = await k$H(X)),
        (z = !T && O !== void 0 && !(await k$H(lqq.join(_0(f), `${O}.jsonl`)))),
        !T)
      )
        await sqH.unlink(X).catch(() => {})
    }
    if (
      this.phase.kind === 'retiring' ||
      this.phase.kind === 'retired' ||
      this.record.outcome
    )
      return
    if (z)
      return (
        this.patch({
          state: 'crashed',
          detail: `source session ${O} not found`,
        }),
        this.settle('crashed')
      )
    if (!this.spawnPty)
      return (
        this.patch({
          state: 'crashed',
          detail: 'Bun.Terminal unavailable (running under Node?)',
        }),
        c('tengu_bg_pty_unavailable', { short: this.dispatch.short }),
        this.settle('crashed')
      )
    let A = e64(_, this.attempt, T, $, Y),
      w = H84(_, q, K, this.rvSockPath ?? x__(_.short))
    if (this.attempt > 1 && T) w.CLAUDE_CODE_RESUME_INTERRUPTED_TURN = '1'
    if (H) Object.assign(w, H)
    let j = this.ptyCols || (_.cols ?? 200),
      J = this.ptyRows || (_.rows ?? 50),
      M
    try {
      let { cmd: D, prefixArgs: f } =
        _.launch.mode === 'exec'
          ? { cmd: _.launch.cmd, prefixArgs: [] }
          : WE({ pinToCurrentBinary: !0 })
      M = this.spawnPty(D, [...f, ...A], {
        cols: j,
        rows: J,
        cwd: _.cwd,
        env: w,
        ptySock: this.ptySockPath ?? BU(_.short),
        short: _.short,
      })
    } catch (D) {
      if (X6(D)) {
        let f = await sqH.access(_.cwd).then(
          () => !0,
          () => !1,
        )
        if (this.record.outcome) return
        if (!f) return this.settleCwdGone('cold')
        let X =
          _.launch.mode === 'exec'
            ? `${_.launch.cmd}: command not found`
            : 'daemon binary was deleted (upgrade in progress) \u2014 run your command again to use the new version'
        c('tengu_bg_spawn_binary_gone', {
          short: this.dispatch.short,
          attempt: this.attempt,
        }),
          this.patch({ state: 'crashed', detail: X })
        let P = `\r
\x1B[2m[${X}]\x1B[0m\r
`
        return this.pushRing(P), this.onStream.emit(P), this.settle('crashed')
      }
      return this.scheduleRespawn(LH(D))
    }
    if (_.launch.mode === 'exec')
      this.execTracker?.dispose(),
        (this.execTracker = dqq(q)),
        (this.workerReady = !0)
    if (n_() === 'windows')
      sqH.writeFile(xOH(_.short), String(M.pid)).catch(() => {})
    this.wirePty(M),
      this.rv?.close(),
      (this.rv = void 0),
      (this.lastRvHeartbeat = void 0),
      (this.stalledLogged = !1),
      this.connectRv(),
      this.patch({
        pid: M.pid,
        attempt: this.attempt,
        state: this.attempt > 1 ? 'resuming' : 'running',
        detail: '',
        cliVersion: {
          ISSUES_EXPLAINER:
            'report the issue at https://github.com/anthropics/claude-code/issues',
          PACKAGE_URL: '@anthropic-ai/claude-code',
          README_URL: 'https://code.claude.com/docs/en/overview',
          VERSION: '2.1.153',
          FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
          BUILD_TIME: '2026-05-27T20:03:21Z',
          GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
        }.VERSION,
      }),
      c('tengu_bg_worker_spawn', {
        short: this.dispatch.short,
        attempt: this.attempt,
        source: this.dispatch.source,
        launch_mode: this.dispatch.launch.mode,
      }),
      ey(M.pid, { skipCache: !0 }).then(D => {
        if (
          !D ||
          this.record.pid !== M.pid ||
          this.isDetached ||
          this.record.outcome
        )
          return
        ;(this.procStart = D), this.patch({ pid: M.pid })
      })
  }
  wirePty(H) {
    ;(this.pty = H),
      this.transitionTo({ kind: 'running' }),
      (this.decModes = fy_()),
      H.onResume?.(() => {
        this.rv?.send({ type: 'repaint' })
      }),
      (this.offData = H.onData(q => {
        if (this.decModes.feed(q) && this.record.pid)
          this.onState.emit({ pid: this.record.pid })
        this.execTracker?.feed(q),
          this.pushRing(q.includes(dSH) ? q.replaceAll(dSH, '') : q),
          this.onStream.emit(q)
      }))
    let _ = !1
    this.offExit = H.onExit(({ exitCode: q, signal: K }) => {
      if (_) return
      ;(_ = !0),
        this.offData?.dispose(),
        (this.execLastLine = this.execTracker?.lastLine),
        this.execTracker?.dispose(),
        (this.execTracker = void 0),
        (this.pty = void 0),
        this.onExit(q, K)
    })
  }
  pushRing(H) {
    if (
      (this.ring.push(H),
      (this.ringBytes += H.length),
      this.ringBytes > EV_ * 1.25 && this.ring.length > 1)
    ) {
      let _ = 0,
        q = 0
      while (this.ringBytes - q > EV_ && _ < this.ring.length - 1)
        (q += this.ring[_].length), _++
      this.ring.splice(0, _),
        (this.ringBytes -= q),
        (this.ringSpawnMark = Math.max(0, this.ringSpawnMark - _))
    }
  }
  patch(H) {
    Object.assign(this.record, H), this.onState.emit(H)
  }
  onExit(H, _) {
    if (this.isDetached) return
    if (this.phase.kind === 'retired') return
    let q = this.lastSpawnAt ? Date.now() - this.lastSpawnAt : void 0,
      K = q !== void 0 && q < a64 && H !== 0
    if (K) this.fastCrashStreak++
    else this.fastCrashStreak = 0
    let O = this.fastCrashStreak >= 3,
      T = this.workerReady ? void 0 : this.preInitErrorTail(),
      z = H !== 0 ? pp6(b4(this.dispatch.short)) : void 0,
      $ = K && !!z && z === this.lastExitCause
    this.lastExitCause = K ? z : void 0
    let Y = T ? ` \u2014 ${T}` : z ? ` \u2014 ${z}` : '',
      A =
        this.dispatch.launch.mode === 'exec' &&
        (_ === 'SIGINT' || _ === 'SIGQUIT'),
      w
    if (this.phase.kind === 'retiring' && this.phase.reason === 'reap')
      w = this.killOutcome
    else if (this.phase.kind === 'retiring' && this.phase.reason === 'grace')
      w = 'done'
    else if (this.phase.kind === 'upgrading') w = void 0
    else if (H === 0) w = 'done'
    else if (this.dispatch.launch.mode === 'exec') w = A ? 'killed' : 'crashed'
    else if (
      (!this.workerReady && (this.attempt >= 2 || T)) ||
      O ||
      $ ||
      this.attempt >= o64
    )
      w = 'crashed'
    if (
      (c('tengu_bg_worker_exit', {
        short: this.dispatch.short,
        code: H ?? void 0,
        signal: _,
        attempt: this.attempt,
        procUptimeMs: q,
        source: this.dispatch.source,
        launch_mode: this.dispatch.launch.mode,
        outcome: w,
        exitCause: z,
      }),
      this.phase.kind === 'retiring')
    )
      return this.settle(
        this.phase.reason === 'reap' ? this.killOutcome : 'done',
      )
    if (this.phase.kind === 'upgrading') {
      this.transitionTo({ kind: 'spawning' }),
        (this.attempt = 1),
        (this.fastCrashStreak = 0),
        (this.lastExitCause = void 0),
        this.patch({ pid: 0, state: 'starting', detail: 'upgrading' }),
        (this.procStart = void 0),
        this.buildBridgeReattachEnvFromState().then(J => this.doSpawn(J))
      return
    }
    if (H === 0) {
      if (this.dispatch.launch.mode === 'exec')
        this.patch({ detail: this.execLastLine || '(no output)' })
      return this.settle('done')
    }
    let j = _ ? `${_} (${H})` : `exit ${H}`
    if (this.dispatch.launch.mode === 'exec') {
      let J = this.execLastLine
      return (
        this.patch({
          state: A ? 'stopped' : 'crashed',
          detail: J ? `${j} \u2014 ${J}` : `${j}${Y}`,
        }),
        this.settle(A ? 'killed' : 'crashed')
      )
    }
    if (!this.workerReady && z === 'spare_postclaim:ENOENT')
      try {
        q84.accessSync(this.dispatch.cwd)
      } catch {
        return this.settleCwdGone('spare')
      }
    if (!this.workerReady && (this.attempt >= 2 || T))
      return (
        this.patch({ state: 'crashed', detail: `${j} before init${Y}` }),
        this.settle('crashed')
      )
    if (O || $)
      return (
        this.patch({
          state: 'crashed',
          detail: $
            ? `${j} \xD7${this.attempt}${Y}`
            : `${j} within ${a64 / 1000}s of spawn \xD7${this.fastCrashStreak}${Y}`,
        }),
        this.settle('crashed')
      )
    this.scheduleRespawn(`${j}${Y}`)
  }
  settleCwdGone(H) {
    let _ = `working directory no longer exists: ${this.dispatch.cwd}`
    c('tengu_bg_spawn_cwd_gone', {
      short: this.dispatch.short,
      attempt: this.attempt,
      via: H,
    }),
      this.patch({ state: 'crashed', detail: _ })
    let q = `\r
\x1B[2m[${_} \u2014 this job cannot be respawned]\x1B[0m\r
`
    this.pushRing(q), this.onStream.emit(q), this.settle('crashed')
  }
  async buildBridgeReattachEnvFromState() {
    let H = await o7(b4(this.dispatch.short)).catch(() => null)
    if (!H) return
    return VjH(H.bridgeSessionId, H.bridgeSessionSeq, H.bridgeOutboundOnly)
  }
  scheduleRespawn(H) {
    if (this.attempt >= o64)
      return (
        c('tengu_bg_respawn_exhausted', {
          short: this.dispatch.short,
          attempts: this.attempt,
        }),
        this.patch({ state: 'crashed', detail: H }),
        this.settle('crashed')
      )
    if (this.phase.kind === 'running') this.transitionTo({ kind: 'spawning' })
    this.patch({ pid: 0, state: 'crashed', detail: `${H}; respawning` }),
      (this.procStart = void 0)
    let _ = `\r
\x1B[2m[worker crashed (${H}) \u2014 respawning\u2026]\x1B[0m\r
`
    this.pushRing(_),
      this.onStream.emit(_),
      (this.backoffTimer = setTimeout(() => {
        if (
          ((this.backoffTimer = null),
          this.phase.kind !== 'retiring' && this.phase.kind !== 'retired')
        )
          this.doSpawn()
      }, $fO)),
      this.backoffTimer.unref()
  }
  settle(H) {
    if (this.record.outcome) return
    c('tengu_bg_settle', {
      short: this.dispatch.short,
      outcome: H,
      uptimeMs: Date.now() - this.record.startedAt,
      attempt: this.attempt,
    }),
      this.transitionTo({ kind: 'retired', outcome: H }),
      this.clearLiveness(),
      this.patch({ outcome: H, settledAt: Date.now(), tempo: 'idle' }),
      this.onSettle.emit(H)
  }
  connectRv() {
    if (this.rv || this.isDetached || this.record.outcome) return
    if (this.dispatch.launch.mode === 'exec') {
      this.startPidPoll()
      return
    }
    ;(this.rv = i64(
      this.rvSockPath ?? x__(this.dispatch.short),
      H => {
        if (H.type === 'heartbeat') this.lastRvHeartbeat = Date.now()
        else if (H.type === 'done') this.settle(H.outcome)
        else if (H.type === 'state') this.patch(H.patch)
        else if (H.type === 'detach-request') this.onStream.emit(MqH(H.msg))
        else if (H.type === 'repaint-done') this.onRepaintDone.emit()
      },
      () => void this.checkPid(),
      () => {
        if (((this.workerReady = !0), this.resizeDeferred))
          (this.resizeDeferred = !1), this.resize(this.ptyCols, this.ptyRows)
        if (this.attachers.size > 0) {
          let H = [...this.attachers.values()].at(-1)
          this.sendAttacherCaps(H.caps ?? null)
        } else this.sendAttacherCaps(null)
      },
    )),
      this.startPidPoll()
  }
  startPidPoll() {
    if (this.pidPoll) return
    ;(this.lastCheckPidAt = Date.now()),
      (this.pidPoll = setInterval(() => void this.checkPid(!0), cqq)),
      this.pidPoll.unref()
  }
  pidRecycled() {
    if (!this.procStart || !this.record.pid) return !1
    let H = VKH(this.record.pid)
    return H !== void 0 && H !== this.procStart
  }
  async pidRecycledAsync() {
    if (!this.procStart || !this.record.pid) return !1
    let H = await ey(this.record.pid)
    return H !== void 0 && H !== this.procStart
  }
  pidPollTick = 0
  async checkPid(H = !1) {
    if (this.record.outcome || !this.record.pid) return
    let _ = Date.now() - this.lastCheckPidAt
    this.lastCheckPidAt = Date.now()
    let q = _ > cqq * 3
    if (q && this.lastRvHeartbeat !== void 0) this.lastRvHeartbeat = Date.now()
    if (!this.pty)
      try {
        process.kill(this.record.pid, 0)
      } catch (O) {
        let T = f6(O)
        if (T === 'ESRCH' || T === 'EPERM')
          this.logVanished(!1, H),
            this.settle(this.isKilling ? 'killed' : 'crashed')
        return
      }
    let K = this.lastRvHeartbeat
    if (!q && !this.stalledLogged && K !== void 0 && Date.now() - K > YfO) {
      let O = await o7(b4(this.dispatch.short))
      if (!this.stalledLogged && (O?.tempo ?? this.record.tempo) === 'active')
        (this.stalledLogged = !0),
          c('tengu_bg_worker_stalled', {
            short: this.dispatch.short,
            sinceMs: Date.now() - K,
          })
    }
    if (this.pty) return
    if (H && this.pidPollTick++ % 12 !== 0) return
    if (await this.pidRecycledAsync()) {
      if (this.record.outcome || this.pty) return
      this.logVanished(!0, H),
        this.settle(this.isKilling ? 'killed' : 'crashed')
    }
  }
  logVanished(H, _) {
    if (this.isKilling) return
    c('tengu_bg_worker_vanished', {
      short: this.dispatch.short,
      recycled: H,
      fromPoll: _,
      uptimeMs: Date.now() - this.record.startedAt,
    })
  }
  clearLiveness() {
    if (this.pidPoll) clearInterval(this.pidPoll), (this.pidPoll = null)
    this.rv?.close(),
      (this.rv = void 0),
      (this.lastRvHeartbeat = void 0),
      (this.stalledLogged = !1)
  }
}
var q84,
  sqH,
  lqq,
  $fO = 1e4,
  o64 = 20,
  a64 = 5000,
  s64 = 200,
  cqq = 5000,
  YfO = 120000,
  AfO = 120000,
  wfO = 300000,
  t64 = 4096,
  rqq
var oqq = R(() => {
  Mk()
  YY()
  N_()
  lH()
  W_()
  OX()
  $9()
  KXH()
  nj()
  $A()
  p6q()
  p64()
  nv()
  cv()
  d64()
  QSH()
  Gy_()
  r64()
  Ln()
  ;(q84 = require('fs')),
    (sqH = require('fs/promises')),
    (lqq = require('path'))
  rqq = [
    'CLAUDE_CODE_QUESTION_PREVIEW_FORMAT',
    'GITHUB_ACTIONS',
    'CLAUDECODE',
    'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_EXECPATH',
    'CLAUDE_CODE_COORDINATOR_MODE',
    'TERM_PROGRAM',
    'TERM_PROGRAM_VERSION',
    '__CFBundleIdentifier',
    'KITTY_WINDOW_ID',
    'WT_SESSION',
    'KONSOLE_VERSION',
    'VTE_VERSION',
    'ZED_TERM',
    'ZELLIJ',
    'TMUX',
    'TMUX_PANE',
    'STY',
    'LC_TERMINAL',
    'SSH_CONNECTION',
    'SSH_CLIENT',
    'SSH_TTY',
    'COLORFGBG',
    'CURSOR_TRACE_ID',
    'GIT_ASKPASS',
    'SSH_ASKPASS',
    'SSH_ASKPASS_REQUIRE',
    'VSCODE_GIT_ASKPASS_MAIN',
    'VSCODE_GIT_ASKPASS_NODE',
    'VSCODE_GIT_ASKPASS_EXTRA_ARGS',
    'VSCODE_GIT_IPC_HANDLE',
    'TERMINAL_EMULATOR',
    'ITERM_SESSION_ID',
    'GNOME_TERMINAL_SERVICE',
    'XTERM_VERSION',
    'ALACRITTY_LOG',
    'TILIX_ID',
    'TERMINATOR_UUID',
    'ConEmuANSI',
    'ConEmuPID',
    'ConEmuTask',
    'MSYSTEM',
    'CLAUDE_CODE_SSE_PORT',
    'FORCE_CODE_TERMINAL',
  ]
})
var ry_ = i(sqq => {
  class aqq extends Error {
    constructor(H, _, q) {
      super(q)
      Error.captureStackTrace(this, this.constructor),
        (this.name = this.constructor.name),
        (this.code = _),
        (this.exitCode = H),
        (this.nestedError = void 0)
    }
  }
  class K84 extends aqq {
    constructor(H) {
      super(1, 'commander.invalidArgument', H)
      Error.captureStackTrace(this, this.constructor),
        (this.name = this.constructor.name)
    }
  }
  sqq.CommanderError = aqq
  sqq.InvalidArgumentError = K84
})
var Ih6 = i(tqq => {
  var { InvalidArgumentError: JfO } = ry_()
  class O84 {
    constructor(H, _) {
      switch (
        ((this.description = _ || ''),
        (this.variadic = !1),
        (this.parseArg = void 0),
        (this.defaultValue = void 0),
        (this.defaultValueDescription = void 0),
        (this.argChoices = void 0),
        H[0])
      ) {
        case '<':
          ;(this.required = !0), (this._name = H.slice(1, -1))
          break
        case '[':
          ;(this.required = !1), (this._name = H.slice(1, -1))
          break
        default:
          ;(this.required = !0), (this._name = H)
          break
      }
      if (this._name.length > 3 && this._name.slice(-3) === '...')
        (this.variadic = !0), (this._name = this._name.slice(0, -3))
    }
    name() {
      return this._name
    }
    _concatValue(H, _) {
      if (_ === this.defaultValue || !Array.isArray(_)) return [H]
      return _.concat(H)
    }
    default(H, _) {
      return (this.defaultValue = H), (this.defaultValueDescription = _), this
    }
    argParser(H) {
      return (this.parseArg = H), this
    }
    choices(H) {
      return (
        (this.argChoices = H.slice()),
        (this.parseArg = (_, q) => {
          if (!this.argChoices.includes(_))
            throw new JfO(`Allowed choices are ${this.argChoices.join(', ')}.`)
          if (this.variadic) return this._concatValue(_, q)
          return _
        }),
        this
      )
    }
    argRequired() {
      return (this.required = !0), this
    }
    argOptional() {
      return (this.required = !1), this
    }
  }
  function MfO(H) {
    let _ = H.name() + (H.variadic === !0 ? '...' : '')
    return H.required ? '<' + _ + '>' : '[' + _ + ']'
  }
  tqq.Argument = O84
  tqq.humanReadableArgName = MfO
})
var eqq = i(z84 => {
  var { humanReadableArgName: DfO } = Ih6()
  class T84 {
    constructor() {
      ;(this.helpWidth = void 0),
        (this.sortSubcommands = !1),
        (this.sortOptions = !1),
        (this.showGlobalOptions = !1)
    }
    visibleCommands(H) {
      let _ = H.commands.filter(K => !K._hidden),
        q = H._getHelpCommand()
      if (q && !q._hidden) _.push(q)
      if (this.sortSubcommands)
        _.sort((K, O) => {
          return K.name().localeCompare(O.name())
        })
      return _
    }
    compareOptions(H, _) {
      let q = K => {
        return K.short ? K.short.replace(/^-/, '') : K.long.replace(/^--/, '')
      }
      return q(H).localeCompare(q(_))
    }
    visibleOptions(H) {
      let _ = H.options.filter(K => !K.hidden),
        q = H._getHelpOption()
      if (q && !q.hidden) {
        let K = q.short && H._findOption(q.short),
          O = q.long && H._findOption(q.long)
        if (!K && !O) _.push(q)
        else if (q.long && !O) _.push(H.createOption(q.long, q.description))
        else if (q.short && !K) _.push(H.createOption(q.short, q.description))
      }
      if (this.sortOptions) _.sort(this.compareOptions)
      return _
    }
    visibleGlobalOptions(H) {
      if (!this.showGlobalOptions) return []
      let _ = []
      for (let q = H.parent; q; q = q.parent) {
        let K = q.options.filter(O => !O.hidden)
        _.push(...K)
      }
      if (this.sortOptions) _.sort(this.compareOptions)
      return _
    }
    visibleArguments(H) {
      if (H._argsDescription)
        H.registeredArguments.forEach(_ => {
          _.description = _.description || H._argsDescription[_.name()] || ''
        })
      if (H.registeredArguments.find(_ => _.description))
        return H.registeredArguments
      return []
    }
    subcommandTerm(H) {
      let _ = H.registeredArguments.map(q => DfO(q)).join(' ')
      return (
        H._name +
        (H._aliases[0] ? '|' + H._aliases[0] : '') +
        (H.options.length ? ' [options]' : '') +
        (_ ? ' ' + _ : '')
      )
    }
    optionTerm(H) {
      return H.flags
    }
    argumentTerm(H) {
      return H.name()
    }
    longestSubcommandTermLength(H, _) {
      return _.visibleCommands(H).reduce((q, K) => {
        return Math.max(q, _.subcommandTerm(K).length)
      }, 0)
    }
    longestOptionTermLength(H, _) {
      return _.visibleOptions(H).reduce((q, K) => {
        return Math.max(q, _.optionTerm(K).length)
      }, 0)
    }
    longestGlobalOptionTermLength(H, _) {
      return _.visibleGlobalOptions(H).reduce((q, K) => {
        return Math.max(q, _.optionTerm(K).length)
      }, 0)
    }
    longestArgumentTermLength(H, _) {
      return _.visibleArguments(H).reduce((q, K) => {
        return Math.max(q, _.argumentTerm(K).length)
      }, 0)
    }
    commandUsage(H) {
      let _ = H._name
      if (H._aliases[0]) _ = _ + '|' + H._aliases[0]
      let q = ''
      for (let K = H.parent; K; K = K.parent) q = K.name() + ' ' + q
      return q + _ + ' ' + H.usage()
    }
    commandDescription(H) {
      return H.description()
    }
    subcommandDescription(H) {
      return H.summary() || H.description()
    }
    optionDescription(H) {
      let _ = []
      if (H.argChoices)
        _.push(
          `choices: ${H.argChoices.map(q => JSON.stringify(q)).join(', ')}`,
        )
      if (H.defaultValue !== void 0) {
        if (
          H.required ||
          H.optional ||
          (H.isBoolean() && typeof H.defaultValue === 'boolean')
        )
          _.push(
            `default: ${H.defaultValueDescription || JSON.stringify(H.defaultValue)}`,
          )
      }
      if (H.presetArg !== void 0 && H.optional)
        _.push(`preset: ${JSON.stringify(H.presetArg)}`)
      if (H.envVar !== void 0) _.push(`env: ${H.envVar}`)
      if (_.length > 0) return `${H.description} (${_.join(', ')})`
      return H.description
    }
    argumentDescription(H) {
      let _ = []
      if (H.argChoices)
        _.push(
          `choices: ${H.argChoices.map(q => JSON.stringify(q)).join(', ')}`,
        )
      if (H.defaultValue !== void 0)
        _.push(
          `default: ${H.defaultValueDescription || JSON.stringify(H.defaultValue)}`,
        )
      if (_.length > 0) {
        let q = `(${_.join(', ')})`
        if (H.description) return `${H.description} ${q}`
        return q
      }
      return H.description
    }
    formatHelp(H, _) {
      let q = _.padWidth(H, _),
        K = _.helpWidth || 80,
        O = 2,
        T = 2
      function z(M, D) {
        if (D) {
          let f = `${M.padEnd(q + 2)}${D}`
          return _.wrap(f, K - 2, q + 2)
        }
        return M
      }
      function $(M) {
        return M.join(`
`).replace(/^/gm, ' '.repeat(2))
      }
      let Y = [`Usage: ${_.commandUsage(H)}`, ''],
        A = _.commandDescription(H)
      if (A.length > 0) Y = Y.concat([_.wrap(A, K, 0), ''])
      let w = _.visibleArguments(H).map(M => {
        return z(_.argumentTerm(M), _.argumentDescription(M))
      })
      if (w.length > 0) Y = Y.concat(['Arguments:', $(w), ''])
      let j = _.visibleOptions(H).map(M => {
        return z(_.optionTerm(M), _.optionDescription(M))
      })
      if (j.length > 0) Y = Y.concat(['Options:', $(j), ''])
      if (this.showGlobalOptions) {
        let M = _.visibleGlobalOptions(H).map(D => {
          return z(_.optionTerm(D), _.optionDescription(D))
        })
        if (M.length > 0) Y = Y.concat(['Global Options:', $(M), ''])
      }
      let J = _.visibleCommands(H).map(M => {
        return z(_.subcommandTerm(M), _.subcommandDescription(M))
      })
      if (J.length > 0) Y = Y.concat(['Commands:', $(J), ''])
      return Y.join(`
`)
    }
    padWidth(H, _) {
      return Math.max(
        _.longestOptionTermLength(H, _),
        _.longestGlobalOptionTermLength(H, _),
        _.longestSubcommandTermLength(H, _),
        _.longestArgumentTermLength(H, _),
      )
    }
    wrap(H, _, q, K = 40) {
      let T = new RegExp(
        `[\\n][${' \\f\\t\\v\xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF'}]+`,
      )
      if (H.match(T)) return H
      let z = _ - q
      if (z < K) return H
      let $ = H.slice(0, q),
        Y = H.slice(q).replace(
          `\r
`,
          `
`,
        ),
        A = ' '.repeat(q),
        j = `\\s${'\u200B'}`,
        J = new RegExp(
          `
|.{1,${z - 1}}([${j}]|$)|[^${j}]+?([${j}]|$)`,
          'g',
        ),
        M = Y.match(J) || []
      return (
        $ +
        M.map((D, f) => {
          if (
            D ===
            `
`
          )
            return ''
          return (f > 0 ? A : '') + D.trimEnd()
        }).join(`
`)
      )
    }
  }
  z84.Help = T84
})
var _9q = i(H9q => {
  var { InvalidArgumentError: ffO } = ry_()
  class $84 {
    constructor(H, _) {
      ;(this.flags = H),
        (this.description = _ || ''),
        (this.required = H.includes('<')),
        (this.optional = H.includes('[')),
        (this.variadic = /\w\.\.\.[>\]]$/.test(H)),
        (this.mandatory = !1)
      let q = PfO(H)
      if (
        ((this.short = q.shortFlag),
        (this.long = q.longFlag),
        (this.negate = !1),
        this.long)
      )
        this.negate = this.long.startsWith('--no-')
      ;(this.defaultValue = void 0),
        (this.defaultValueDescription = void 0),
        (this.presetArg = void 0),
        (this.envVar = void 0),
        (this.parseArg = void 0),
        (this.hidden = !1),
        (this.argChoices = void 0),
        (this.conflictsWith = []),
        (this.implied = void 0)
    }
    default(H, _) {
      return (this.defaultValue = H), (this.defaultValueDescription = _), this
    }
    preset(H) {
      return (this.presetArg = H), this
    }
    conflicts(H) {
      return (this.conflictsWith = this.conflictsWith.concat(H)), this
    }
    implies(H) {
      let _ = H
      if (typeof H === 'string') _ = { [H]: !0 }
      return (this.implied = Object.assign(this.implied || {}, _)), this
    }
    env(H) {
      return (this.envVar = H), this
    }
    argParser(H) {
      return (this.parseArg = H), this
    }
    makeOptionMandatory(H = !0) {
      return (this.mandatory = !!H), this
    }
    hideHelp(H = !0) {
      return (this.hidden = !!H), this
    }
    _concatValue(H, _) {
      if (_ === this.defaultValue || !Array.isArray(_)) return [H]
      return _.concat(H)
    }
    choices(H) {
      return (
        (this.argChoices = H.slice()),
        (this.parseArg = (_, q) => {
          if (!this.argChoices.includes(_))
            throw new ffO(`Allowed choices are ${this.argChoices.join(', ')}.`)
          if (this.variadic) return this._concatValue(_, q)
          return _
        }),
        this
      )
    }
    name() {
      if (this.long) return this.long.replace(/^--/, '')
      return this.short.replace(/^-/, '')
    }
    attributeName() {
      return XfO(this.name().replace(/^no-/, ''))
    }
    is(H) {
      return this.short === H || this.long === H
    }
    isBoolean() {
      return !this.required && !this.optional && !this.negate
    }
  }
  class Y84 {
    constructor(H) {
      ;(this.positiveOptions = new Map()),
        (this.negativeOptions = new Map()),
        (this.dualOptions = new Set()),
        H.forEach(_ => {
          if (_.negate) this.negativeOptions.set(_.attributeName(), _)
          else this.positiveOptions.set(_.attributeName(), _)
        }),
        this.negativeOptions.forEach((_, q) => {
          if (this.positiveOptions.has(q)) this.dualOptions.add(q)
        })
    }
    valueFromOption(H, _) {
      let q = _.attributeName()
      if (!this.dualOptions.has(q)) return !0
      let K = this.negativeOptions.get(q).presetArg,
        O = K !== void 0 ? K : !1
      return _.negate === (O === H)
    }
  }
  function XfO(H) {
    return H.split('-').reduce((_, q) => {
      return _ + q[0].toUpperCase() + q.slice(1)
    })
  }
  function PfO(H) {
    let _,
      q,
      K = H.split(/[ |,]+/)
    if (K.length > 1 && !/^[[<]/.test(K[1])) _ = K.shift()
    if (((q = K.shift()), !_ && /^-[^-]$/.test(q))) (_ = q), (q = void 0)
    return { shortFlag: _, longFlag: q }
  }
  H9q.Option = $84
  H9q.DualOptions = Y84
})
var w84 = i(A84 => {
  function WfO(H, _) {
    if (Math.abs(H.length - _.length) > 3) return Math.max(H.length, _.length)
    let q = []
    for (let K = 0; K <= H.length; K++) q[K] = [K]
    for (let K = 0; K <= _.length; K++) q[0][K] = K
    for (let K = 1; K <= _.length; K++)
      for (let O = 1; O <= H.length; O++) {
        let T = 1
        if (H[O - 1] === _[K - 1]) T = 0
        else T = 1
        if (
          ((q[O][K] = Math.min(
            q[O - 1][K] + 1,
            q[O][K - 1] + 1,
            q[O - 1][K - 1] + T,
          )),
          O > 1 && K > 1 && H[O - 1] === _[K - 2] && H[O - 2] === _[K - 1])
        )
          q[O][K] = Math.min(q[O][K], q[O - 2][K - 2] + 1)
      }
    return q[H.length][_.length]
  }
  function ZfO(H, _) {
    if (!_ || _.length === 0) return ''
    _ = Array.from(new Set(_))
    let q = H.startsWith('--')
    if (q) (H = H.slice(2)), (_ = _.map(z => z.slice(2)))
    let K = [],
      O = 3,
      T = 0.4
    if (
      (_.forEach(z => {
        if (z.length <= 1) return
        let $ = WfO(H, z),
          Y = Math.max(H.length, z.length)
        if ((Y - $) / Y > T) {
          if ($ < O) (O = $), (K = [z])
          else if ($ === O) K.push(z)
        }
      }),
      K.sort((z, $) => z.localeCompare($)),
      q)
    )
      K = K.map(z => `--${z}`)
    if (K.length > 1)
      return `
(Did you mean one of ${K.join(', ')}?)`
    if (K.length === 1)
      return `
(Did you mean ${K[0]}?)`
    return ''
  }
  A84.suggestSimilar = ZfO
})
var f84 = i(D84 => {
  var GfO = require('events').EventEmitter,
    q9q = require('child_process'),
    kTH = require('path'),
    K9q = require('fs'),
    UW = require('process'),
    { Argument: RfO, humanReadableArgName: LfO } = Ih6(),
    { CommanderError: O9q } = ry_(),
    { Help: kfO } = eqq(),
    { Option: j84, DualOptions: VfO } = _9q(),
    { suggestSimilar: J84 } = w84()
  class T9q extends GfO {
    constructor(H) {
      super()
      ;(this.commands = []),
        (this.options = []),
        (this.parent = null),
        (this._allowUnknownOption = !1),
        (this._allowExcessArguments = !0),
        (this.registeredArguments = []),
        (this._args = this.registeredArguments),
        (this.args = []),
        (this.rawArgs = []),
        (this.processedArgs = []),
        (this._scriptPath = null),
        (this._name = H || ''),
        (this._optionValues = {}),
        (this._optionValueSources = {}),
        (this._storeOptionsAsProperties = !1),
        (this._actionHandler = null),
        (this._executableHandler = !1),
        (this._executableFile = null),
        (this._executableDir = null),
        (this._defaultCommandName = null),
        (this._exitCallback = null),
        (this._aliases = []),
        (this._combineFlagAndOptionalValue = !0),
        (this._description = ''),
        (this._summary = ''),
        (this._argsDescription = void 0),
        (this._enablePositionalOptions = !1),
        (this._passThroughOptions = !1),
        (this._lifeCycleHooks = {}),
        (this._showHelpAfterError = !1),
        (this._showSuggestionAfterError = !0),
        (this._outputConfiguration = {
          writeOut: _ => UW.stdout.write(_),
          writeErr: _ => UW.stderr.write(_),
          getOutHelpWidth: () => (UW.stdout.isTTY ? UW.stdout.columns : void 0),
          getErrHelpWidth: () => (UW.stderr.isTTY ? UW.stderr.columns : void 0),
          outputError: (_, q) => q(_),
        }),
        (this._hidden = !1),
        (this._helpOption = void 0),
        (this._addImplicitHelpCommand = void 0),
        (this._helpCommand = void 0),
        (this._helpConfiguration = {})
    }
    copyInheritedSettings(H) {
      return (
        (this._outputConfiguration = H._outputConfiguration),
        (this._helpOption = H._helpOption),
        (this._helpCommand = H._helpCommand),
        (this._helpConfiguration = H._helpConfiguration),
        (this._exitCallback = H._exitCallback),
        (this._storeOptionsAsProperties = H._storeOptionsAsProperties),
        (this._combineFlagAndOptionalValue = H._combineFlagAndOptionalValue),
        (this._allowExcessArguments = H._allowExcessArguments),
        (this._enablePositionalOptions = H._enablePositionalOptions),
        (this._showHelpAfterError = H._showHelpAfterError),
        (this._showSuggestionAfterError = H._showSuggestionAfterError),
        this
      )
    }
    _getCommandAndAncestors() {
      let H = []
      for (let _ = this; _; _ = _.parent) H.push(_)
      return H
    }
    command(H, _, q) {
      let K = _,
        O = q
      if (typeof K === 'object' && K !== null) (O = K), (K = null)
      O = O || {}
      let [, T, z] = H.match(/([^ ]+) *(.*)/),
        $ = this.createCommand(T)
      if (K) $.description(K), ($._executableHandler = !0)
      if (O.isDefault) this._defaultCommandName = $._name
      if (
        (($._hidden = !!(O.noHelp || O.hidden)),
        ($._executableFile = O.executableFile || null),
        z)
      )
        $.arguments(z)
      if (
        (this._registerCommand($),
        ($.parent = this),
        $.copyInheritedSettings(this),
        K)
      )
        return this
      return $
    }
    createCommand(H) {
      return new T9q(H)
    }
    createHelp() {
      return Object.assign(new kfO(), this.configureHelp())
    }
    configureHelp(H) {
      if (H === void 0) return this._helpConfiguration
      return (this._helpConfiguration = H), this
    }
    configureOutput(H) {
      if (H === void 0) return this._outputConfiguration
      return Object.assign(this._outputConfiguration, H), this
    }
    showHelpAfterError(H = !0) {
      if (typeof H !== 'string') H = !!H
      return (this._showHelpAfterError = H), this
    }
    showSuggestionAfterError(H = !0) {
      return (this._showSuggestionAfterError = !!H), this
    }
    addCommand(H, _) {
      if (!H._name)
        throw Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`)
      if (((_ = _ || {}), _.isDefault)) this._defaultCommandName = H._name
      if (_.noHelp || _.hidden) H._hidden = !0
      return (
        this._registerCommand(H),
        (H.parent = this),
        H._checkForBrokenPassThrough(),
        this
      )
    }
    createArgument(H, _) {
      return new RfO(H, _)
    }
    argument(H, _, q, K) {
      let O = this.createArgument(H, _)
      if (typeof q === 'function') O.default(K).argParser(q)
      else O.default(q)
      return this.addArgument(O), this
    }
    arguments(H) {
      return (
        H.trim()
          .split(/ +/)
          .forEach(_ => {
            this.argument(_)
          }),
        this
      )
    }
    addArgument(H) {
      let _ = this.registeredArguments.slice(-1)[0]
      if (_ && _.variadic)
        throw Error(`only the last argument can be variadic '${_.name()}'`)
      if (H.required && H.defaultValue !== void 0 && H.parseArg === void 0)
        throw Error(
          `a default value for a required argument is never used: '${H.name()}'`,
        )
      return this.registeredArguments.push(H), this
    }
    helpCommand(H, _) {
      if (typeof H === 'boolean')
        return (this._addImplicitHelpCommand = H), this
      H = H ?? 'help [command]'
      let [, q, K] = H.match(/([^ ]+) *(.*)/),
        O = _ ?? 'display help for command',
        T = this.createCommand(q)
      if ((T.helpOption(!1), K)) T.arguments(K)
      if (O) T.description(O)
      return (this._addImplicitHelpCommand = !0), (this._helpCommand = T), this
    }
    addHelpCommand(H, _) {
      if (typeof H !== 'object') return this.helpCommand(H, _), this
      return (this._addImplicitHelpCommand = !0), (this._helpCommand = H), this
    }
    _getHelpCommand() {
      if (
        this._addImplicitHelpCommand ??
        (this.commands.length &&
          !this._actionHandler &&
          !this._findCommand('help'))
      ) {
        if (this._helpCommand === void 0) this.helpCommand(void 0, void 0)
        return this._helpCommand
      }
      return null
    }
    hook(H, _) {
      let q = ['preSubcommand', 'preAction', 'postAction']
      if (!q.includes(H))
        throw Error(`Unexpected value for event passed to hook : '${H}'.
Expecting one of '${q.join("', '")}'`)
      if (this._lifeCycleHooks[H]) this._lifeCycleHooks[H].push(_)
      else this._lifeCycleHooks[H] = [_]
      return this
    }
    exitOverride(H) {
      if (H) this._exitCallback = H
      else
        this._exitCallback = _ => {
          if (_.code !== 'commander.executeSubCommandAsync') throw _
        }
      return this
    }
    _exit(H, _, q) {
      if (this._exitCallback) this._exitCallback(new O9q(H, _, q))
      UW.exit(H)
    }
    action(H) {
      let _ = q => {
        let K = this.registeredArguments.length,
          O = q.slice(0, K)
        if (this._storeOptionsAsProperties) O[K] = this
        else O[K] = this.opts()
        return O.push(this), H.apply(this, O)
      }
      return (this._actionHandler = _), this
    }
    createOption(H, _) {
      return new j84(H, _)
    }
    _callParseArg(H, _, q, K) {
      try {
        return H.parseArg(_, q)
      } catch (O) {
        if (O.code === 'commander.invalidArgument') {
          let T = `${K} ${O.message}`
          this.error(T, { exitCode: O.exitCode, code: O.code })
        }
        throw O
      }
    }
    _registerOption(H) {
      let _ =
        (H.short && this._findOption(H.short)) ||
        (H.long && this._findOption(H.long))
      if (_) {
        let q = H.long && this._findOption(H.long) ? H.long : H.short
        throw Error(`Cannot add option '${H.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${q}'
-  already used by option '${_.flags}'`)
      }
      this.options.push(H)
    }
    _registerCommand(H) {
      let _ = K => {
          return [K.name()].concat(K.aliases())
        },
        q = _(H).find(K => this._findCommand(K))
      if (q) {
        let K = _(this._findCommand(q)).join('|'),
          O = _(H).join('|')
        throw Error(`cannot add command '${O}' as already have command '${K}'`)
      }
      this.commands.push(H)
    }
    addOption(H) {
      this._registerOption(H)
      let _ = H.name(),
        q = H.attributeName()
      if (H.negate) {
        let O = H.long.replace(/^--no-/, '--')
        if (!this._findOption(O))
          this.setOptionValueWithSource(
            q,
            H.defaultValue === void 0 ? !0 : H.defaultValue,
            'default',
          )
      } else if (H.defaultValue !== void 0)
        this.setOptionValueWithSource(q, H.defaultValue, 'default')
      let K = (O, T, z) => {
        if (O == null && H.presetArg !== void 0) O = H.presetArg
        let $ = this.getOptionValue(q)
        if (O !== null && H.parseArg) O = this._callParseArg(H, O, $, T)
        else if (O !== null && H.variadic) O = H._concatValue(O, $)
        if (O == null)
          if (H.negate) O = !1
          else if (H.isBoolean() || H.optional) O = !0
          else O = ''
        this.setOptionValueWithSource(q, O, z)
      }
      if (
        (this.on('option:' + _, O => {
          let T = `error: option '${H.flags}' argument '${O}' is invalid.`
          K(O, T, 'cli')
        }),
        H.envVar)
      )
        this.on('optionEnv:' + _, O => {
          let T = `error: option '${H.flags}' value '${O}' from env '${H.envVar}' is invalid.`
          K(O, T, 'env')
        })
      return this
    }
    _optionEx(H, _, q, K, O) {
      if (typeof _ === 'object' && _ instanceof j84)
        throw Error(
          'To add an Option object use addOption() instead of option() or requiredOption()',
        )
      let T = this.createOption(_, q)
      if ((T.makeOptionMandatory(!!H.mandatory), typeof K === 'function'))
        T.default(O).argParser(K)
      else if (K instanceof RegExp) {
        let z = K
        ;(K = ($, Y) => {
          let A = z.exec($)
          return A ? A[0] : Y
        }),
          T.default(O).argParser(K)
      } else T.default(K)
      return this.addOption(T)
    }
    option(H, _, q, K) {
      return this._optionEx({}, H, _, q, K)
    }
    requiredOption(H, _, q, K) {
      return this._optionEx({ mandatory: !0 }, H, _, q, K)
    }
    combineFlagAndOptionalValue(H = !0) {
      return (this._combineFlagAndOptionalValue = !!H), this
    }
    allowUnknownOption(H = !0) {
      return (this._allowUnknownOption = !!H), this
    }
    allowExcessArguments(H = !0) {
      return (this._allowExcessArguments = !!H), this
    }
    enablePositionalOptions(H = !0) {
      return (this._enablePositionalOptions = !!H), this
    }
    passThroughOptions(H = !0) {
      return (
        (this._passThroughOptions = !!H),
        this._checkForBrokenPassThrough(),
        this
      )
    }
    _checkForBrokenPassThrough() {
      if (
        this.parent &&
        this._passThroughOptions &&
        !this.parent._enablePositionalOptions
      )
        throw Error(
          `passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`,
        )
    }
    storeOptionsAsProperties(H = !0) {
      if (this.options.length)
        throw Error('call .storeOptionsAsProperties() before adding options')
      if (Object.keys(this._optionValues).length)
        throw Error(
          'call .storeOptionsAsProperties() before setting option values',
        )
      return (this._storeOptionsAsProperties = !!H), this
    }
    getOptionValue(H) {
      if (this._storeOptionsAsProperties) return this[H]
      return this._optionValues[H]
    }
    setOptionValue(H, _) {
      return this.setOptionValueWithSource(H, _, void 0)
    }
    setOptionValueWithSource(H, _, q) {
      if (this._storeOptionsAsProperties) this[H] = _
      else this._optionValues[H] = _
      return (this._optionValueSources[H] = q), this
    }
    getOptionValueSource(H) {
      return this._optionValueSources[H]
    }
    getOptionValueSourceWithGlobals(H) {
      let _
      return (
        this._getCommandAndAncestors().forEach(q => {
          if (q.getOptionValueSource(H) !== void 0)
            _ = q.getOptionValueSource(H)
        }),
        _
      )
    }
    _prepareUserArgs(H, _) {
      if (H !== void 0 && !Array.isArray(H))
        throw Error('first parameter to parse must be array or undefined')
      if (((_ = _ || {}), H === void 0 && _.from === void 0)) {
        if (UW.versions?.electron) _.from = 'electron'
        let K = UW.execArgv ?? []
        if (
          K.includes('-e') ||
          K.includes('--eval') ||
          K.includes('-p') ||
          K.includes('--print')
        )
          _.from = 'eval'
      }
      if (H === void 0) H = UW.argv
      this.rawArgs = H.slice()
      let q
      switch (_.from) {
        case void 0:
        case 'node':
          ;(this._scriptPath = H[1]), (q = H.slice(2))
          break
        case 'electron':
          if (UW.defaultApp) (this._scriptPath = H[1]), (q = H.slice(2))
          else q = H.slice(1)
          break
        case 'user':
          q = H.slice(0)
          break
        case 'eval':
          q = H.slice(1)
          break
        default:
          throw Error(`unexpected parse option { from: '${_.from}' }`)
      }
      if (!this._name && this._scriptPath)
        this.nameFromFilename(this._scriptPath)
      return (this._name = this._name || 'program'), q
    }
    parse(H, _) {
      let q = this._prepareUserArgs(H, _)
      return this._parseCommand([], q), this
    }
    async parseAsync(H, _) {
      let q = this._prepareUserArgs(H, _)
      return await this._parseCommand([], q), this
    }
    _executeSubCommand(H, _) {
      _ = _.slice()
      let q = !1,
        K = ['.js', '.ts', '.tsx', '.mjs', '.cjs']
      function O(A, w) {
        let j = kTH.resolve(A, w)
        if (K9q.existsSync(j)) return j
        if (K.includes(kTH.extname(w))) return
        let J = K.find(M => K9q.existsSync(`${j}${M}`))
        if (J) return `${j}${J}`
        return
      }
      this._checkForMissingMandatoryOptions(),
        this._checkForConflictingOptions()
      let T = H._executableFile || `${this._name}-${H._name}`,
        z = this._executableDir || ''
      if (this._scriptPath) {
        let A
        try {
          A = K9q.realpathSync(this._scriptPath)
        } catch (w) {
          A = this._scriptPath
        }
        z = kTH.resolve(kTH.dirname(A), z)
      }
      if (z) {
        let A = O(z, T)
        if (!A && !H._executableFile && this._scriptPath) {
          let w = kTH.basename(this._scriptPath, kTH.extname(this._scriptPath))
          if (w !== this._name) A = O(z, `${w}-${H._name}`)
        }
        T = A || T
      }
      q = K.includes(kTH.extname(T))
      let $
      if (UW.platform !== 'win32')
        if (q)
          _.unshift(T),
            (_ = M84(UW.execArgv).concat(_)),
            ($ = q9q.spawn(UW.argv[0], _, { stdio: 'inherit' }))
        else $ = q9q.spawn(T, _, { stdio: 'inherit' })
      else
        _.unshift(T),
          (_ = M84(UW.execArgv).concat(_)),
          ($ = q9q.spawn(UW.execPath, _, { stdio: 'inherit' }))
      if (!$.killed)
        ['SIGUSR1', 'SIGUSR2', 'SIGTERM', 'SIGINT', 'SIGHUP'].forEach(w => {
          UW.on(w, () => {
            if ($.killed === !1 && $.exitCode === null) $.kill(w)
          })
        })
      let Y = this._exitCallback
      $.on('close', A => {
        if (((A = A ?? 1), !Y)) UW.exit(A)
        else Y(new O9q(A, 'commander.executeSubCommandAsync', '(close)'))
      }),
        $.on('error', A => {
          if (A.code === 'ENOENT') {
            let w = z
                ? `searched for local subcommand relative to directory '${z}'`
                : 'no directory for search for local subcommand, use .executableDir() to supply a custom directory',
              j = `'${T}' does not exist
 - if '${H._name}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${w}`
            throw Error(j)
          } else if (A.code === 'EACCES') throw Error(`'${T}' not executable`)
          if (!Y) UW.exit(1)
          else {
            let w = new O9q(1, 'commander.executeSubCommandAsync', '(error)')
            ;(w.nestedError = A), Y(w)
          }
        }),
        (this.runningCommand = $)
    }
    _dispatchSubcommand(H, _, q) {
      let K = this._findCommand(H)
      if (!K) this.help({ error: !0 })
      let O
      return (
        (O = this._chainOrCallSubCommandHook(O, K, 'preSubcommand')),
        (O = this._chainOrCall(O, () => {
          if (K._executableHandler) this._executeSubCommand(K, _.concat(q))
          else return K._parseCommand(_, q)
        })),
        O
      )
    }
    _dispatchHelpCommand(H) {
      if (!H) this.help()
      let _ = this._findCommand(H)
      if (_ && !_._executableHandler) _.help()
      return this._dispatchSubcommand(
        H,
        [],
        [
          this._getHelpOption()?.long ??
            this._getHelpOption()?.short ??
            '--help',
        ],
      )
    }
    _checkNumberOfArguments() {
      if (
        (this.registeredArguments.forEach((H, _) => {
          if (H.required && this.args[_] == null) this.missingArgument(H.name())
        }),
        this.registeredArguments.length > 0 &&
          this.registeredArguments[this.registeredArguments.length - 1]
            .variadic)
      )
        return
      if (this.args.length > this.registeredArguments.length)
        this._excessArguments(this.args)
    }
    _processArguments() {
      let H = (q, K, O) => {
        let T = K
        if (K !== null && q.parseArg) {
          let z = `error: command-argument value '${K}' is invalid for argument '${q.name()}'.`
          T = this._callParseArg(q, K, O, z)
        }
        return T
      }
      this._checkNumberOfArguments()
      let _ = []
      this.registeredArguments.forEach((q, K) => {
        let O = q.defaultValue
        if (q.variadic) {
          if (K < this.args.length) {
            if (((O = this.args.slice(K)), q.parseArg))
              O = O.reduce((T, z) => {
                return H(q, z, T)
              }, q.defaultValue)
          } else if (O === void 0) O = []
        } else if (K < this.args.length) {
          if (((O = this.args[K]), q.parseArg)) O = H(q, O, q.defaultValue)
        }
        _[K] = O
      }),
        (this.processedArgs = _)
    }
    _chainOrCall(H, _) {
      if (H && H.then && typeof H.then === 'function') return H.then(() => _())
      return _()
    }
    _chainOrCallHooks(H, _) {
      let q = H,
        K = []
      if (
        (this._getCommandAndAncestors()
          .reverse()
          .filter(O => O._lifeCycleHooks[_] !== void 0)
          .forEach(O => {
            O._lifeCycleHooks[_].forEach(T => {
              K.push({ hookedCommand: O, callback: T })
            })
          }),
        _ === 'postAction')
      )
        K.reverse()
      return (
        K.forEach(O => {
          q = this._chainOrCall(q, () => {
            return O.callback(O.hookedCommand, this)
          })
        }),
        q
      )
    }
    _chainOrCallSubCommandHook(H, _, q) {
      let K = H
      if (this._lifeCycleHooks[q] !== void 0)
        this._lifeCycleHooks[q].forEach(O => {
          K = this._chainOrCall(K, () => {
            return O(this, _)
          })
        })
      return K
    }
    _parseCommand(H, _) {
      let q = this.parseOptions(_)
      if (
        (this._parseOptionsEnv(),
        this._parseOptionsImplied(),
        (H = H.concat(q.operands)),
        (_ = q.unknown),
        (this.args = H.concat(_)),
        H && this._findCommand(H[0]))
      )
        return this._dispatchSubcommand(H[0], H.slice(1), _)
      if (this._getHelpCommand() && H[0] === this._getHelpCommand().name())
        return this._dispatchHelpCommand(H[1])
      if (this._defaultCommandName)
        return (
          this._outputHelpIfRequested(_),
          this._dispatchSubcommand(this._defaultCommandName, H, _)
        )
      if (
        this.commands.length &&
        this.args.length === 0 &&
        !this._actionHandler &&
        !this._defaultCommandName
      )
        this.help({ error: !0 })
      this._outputHelpIfRequested(q.unknown),
        this._checkForMissingMandatoryOptions(),
        this._checkForConflictingOptions()
      let K = () => {
          if (q.unknown.length > 0) this.unknownOption(q.unknown[0])
        },
        O = `command:${this.name()}`
      if (this._actionHandler) {
        K(), this._processArguments()
        let T
        if (
          ((T = this._chainOrCallHooks(T, 'preAction')),
          (T = this._chainOrCall(T, () =>
            this._actionHandler(this.processedArgs),
          )),
          this.parent)
        )
          T = this._chainOrCall(T, () => {
            this.parent.emit(O, H, _)
          })
        return (T = this._chainOrCallHooks(T, 'postAction')), T
      }
      if (this.parent && this.parent.listenerCount(O))
        K(), this._processArguments(), this.parent.emit(O, H, _)
      else if (H.length) {
        if (this._findCommand('*')) return this._dispatchSubcommand('*', H, _)
        if (this.listenerCount('command:*')) this.emit('command:*', H, _)
        else if (this.commands.length) this.unknownCommand()
        else K(), this._processArguments()
      } else if (this.commands.length) K(), this.help({ error: !0 })
      else K(), this._processArguments()
    }
    _findCommand(H) {
      if (!H) return
      return this.commands.find(_ => _._name === H || _._aliases.includes(H))
    }
    _findOption(H) {
      return this.options.find(_ => _.is(H))
    }
    _checkForMissingMandatoryOptions() {
      this._getCommandAndAncestors().forEach(H => {
        H.options.forEach(_ => {
          if (_.mandatory && H.getOptionValue(_.attributeName()) === void 0)
            H.missingMandatoryOptionValue(_)
        })
      })
    }
    _checkForConflictingLocalOptions() {
      let H = this.options.filter(q => {
        let K = q.attributeName()
        if (this.getOptionValue(K) === void 0) return !1
        return this.getOptionValueSource(K) !== 'default'
      })
      H.filter(q => q.conflictsWith.length > 0).forEach(q => {
        let K = H.find(O => q.conflictsWith.includes(O.attributeName()))
        if (K) this._conflictingOption(q, K)
      })
    }
    _checkForConflictingOptions() {
      this._getCommandAndAncestors().forEach(H => {
        H._checkForConflictingLocalOptions()
      })
    }
    parseOptions(H) {
      let _ = [],
        q = [],
        K = _,
        O = H.slice()
      function T($) {
        return $.length > 1 && $[0] === '-'
      }
      let z = null
      while (O.length) {
        let $ = O.shift()
        if ($ === '--') {
          if (K === q) K.push($)
          K.push(...O)
          break
        }
        if (z && !T($)) {
          this.emit(`option:${z.name()}`, $)
          continue
        }
        if (((z = null), T($))) {
          let Y = this._findOption($)
          if (Y) {
            if (Y.required) {
              let A = O.shift()
              if (A === void 0) this.optionMissingArgument(Y)
              this.emit(`option:${Y.name()}`, A)
            } else if (Y.optional) {
              let A = null
              if (O.length > 0 && !T(O[0])) A = O.shift()
              this.emit(`option:${Y.name()}`, A)
            } else this.emit(`option:${Y.name()}`)
            z = Y.variadic ? Y : null
            continue
          }
        }
        if ($.length > 2 && $[0] === '-' && $[1] !== '-') {
          let Y = this._findOption(`-${$[1]}`)
          if (Y) {
            if (Y.required || (Y.optional && this._combineFlagAndOptionalValue))
              this.emit(`option:${Y.name()}`, $.slice(2))
            else this.emit(`option:${Y.name()}`), O.unshift(`-${$.slice(2)}`)
            continue
          }
        }
        if (/^--[^=]+=/.test($)) {
          let Y = $.indexOf('='),
            A = this._findOption($.slice(0, Y))
          if (A && (A.required || A.optional)) {
            this.emit(`option:${A.name()}`, $.slice(Y + 1))
            continue
          }
        }
        if (T($)) K = q
        if (
          (this._enablePositionalOptions || this._passThroughOptions) &&
          _.length === 0 &&
          q.length === 0
        ) {
          if (this._findCommand($)) {
            if ((_.push($), O.length > 0)) q.push(...O)
            break
          } else if (
            this._getHelpCommand() &&
            $ === this._getHelpCommand().name()
          ) {
            if ((_.push($), O.length > 0)) _.push(...O)
            break
          } else if (this._defaultCommandName) {
            if ((q.push($), O.length > 0)) q.push(...O)
            break
          }
        }
        if (this._passThroughOptions) {
          if ((K.push($), O.length > 0)) K.push(...O)
          break
        }
        K.push($)
      }
      return { operands: _, unknown: q }
    }
    opts() {
      if (this._storeOptionsAsProperties) {
        let H = {},
          _ = this.options.length
        for (let q = 0; q < _; q++) {
          let K = this.options[q].attributeName()
          H[K] = K === this._versionOptionName ? this._version : this[K]
        }
        return H
      }
      return this._optionValues
    }
    optsWithGlobals() {
      return this._getCommandAndAncestors().reduce(
        (H, _) => Object.assign(H, _.opts()),
        {},
      )
    }
    error(H, _) {
      if (
        (this._outputConfiguration.outputError(
          `${H}
`,
          this._outputConfiguration.writeErr,
        ),
        typeof this._showHelpAfterError === 'string')
      )
        this._outputConfiguration.writeErr(`${this._showHelpAfterError}
`)
      else if (this._showHelpAfterError)
        this._outputConfiguration.writeErr(`
`),
          this.outputHelp({ error: !0 })
      let q = _ || {},
        K = q.exitCode || 1,
        O = q.code || 'commander.error'
      this._exit(K, O, H)
    }
    _parseOptionsEnv() {
      this.options.forEach(H => {
        if (H.envVar && H.envVar in UW.env) {
          let _ = H.attributeName()
          if (
            this.getOptionValue(_) === void 0 ||
            ['default', 'config', 'env'].includes(this.getOptionValueSource(_))
          )
            if (H.required || H.optional)
              this.emit(`optionEnv:${H.name()}`, UW.env[H.envVar])
            else this.emit(`optionEnv:${H.name()}`)
        }
      })
    }
    _parseOptionsImplied() {
      let H = new VfO(this.options),
        _ = q => {
          return (
            this.getOptionValue(q) !== void 0 &&
            !['default', 'implied'].includes(this.getOptionValueSource(q))
          )
        }
      this.options
        .filter(
          q =>
            q.implied !== void 0 &&
            _(q.attributeName()) &&
            H.valueFromOption(this.getOptionValue(q.attributeName()), q),
        )
        .forEach(q => {
          Object.keys(q.implied)
            .filter(K => !_(K))
            .forEach(K => {
              this.setOptionValueWithSource(K, q.implied[K], 'implied')
            })
        })
    }
    missingArgument(H) {
      let _ = `error: missing required argument '${H}'`
      this.error(_, { code: 'commander.missingArgument' })
    }
    optionMissingArgument(H) {
      let _ = `error: option '${H.flags}' argument missing`
      this.error(_, { code: 'commander.optionMissingArgument' })
    }
    missingMandatoryOptionValue(H) {
      let _ = `error: required option '${H.flags}' not specified`
      this.error(_, { code: 'commander.missingMandatoryOptionValue' })
    }
    _conflictingOption(H, _) {
      let q = T => {
          let z = T.attributeName(),
            $ = this.getOptionValue(z),
            Y = this.options.find(w => w.negate && z === w.attributeName()),
            A = this.options.find(w => !w.negate && z === w.attributeName())
          if (
            Y &&
            ((Y.presetArg === void 0 && $ === !1) ||
              (Y.presetArg !== void 0 && $ === Y.presetArg))
          )
            return Y
          return A || T
        },
        K = T => {
          let z = q(T),
            $ = z.attributeName()
          if (this.getOptionValueSource($) === 'env')
            return `environment variable '${z.envVar}'`
          return `option '${z.flags}'`
        },
        O = `error: ${K(H)} cannot be used with ${K(_)}`
      this.error(O, { code: 'commander.conflictingOption' })
    }
    unknownOption(H) {
      if (this._allowUnknownOption) return
      let _ = ''
      if (H.startsWith('--') && this._showSuggestionAfterError) {
        let K = [],
          O = this
        do {
          let T = O.createHelp()
            .visibleOptions(O)
            .filter(z => z.long)
            .map(z => z.long)
          ;(K = K.concat(T)), (O = O.parent)
        } while (O && !O._enablePositionalOptions)
        _ = J84(H, K)
      }
      let q = `error: unknown option '${H}'${_}`
      this.error(q, { code: 'commander.unknownOption' })
    }
    _excessArguments(H) {
      if (this._allowExcessArguments) return
      let _ = this.registeredArguments.length,
        q = _ === 1 ? '' : 's',
        O = `error: too many arguments${this.parent ? ` for '${this.name()}'` : ''}. Expected ${_} argument${q} but got ${H.length}.`
      this.error(O, { code: 'commander.excessArguments' })
    }
    unknownCommand() {
      let H = this.args[0],
        _ = ''
      if (this._showSuggestionAfterError) {
        let K = []
        this.createHelp()
          .visibleCommands(this)
          .forEach(O => {
            if ((K.push(O.name()), O.alias())) K.push(O.alias())
          }),
          (_ = J84(H, K))
      }
      let q = `error: unknown command '${H}'${_}`
      this.error(q, { code: 'commander.unknownCommand' })
    }
    version(H, _, q) {
      if (H === void 0) return this._version
      ;(this._version = H),
        (_ = _ || '-V, --version'),
        (q = q || 'output the version number')
      let K = this.createOption(_, q)
      return (
        (this._versionOptionName = K.attributeName()),
        this._registerOption(K),
        this.on('option:' + K.name(), () => {
          this._outputConfiguration.writeOut(`${H}
`),
            this._exit(0, 'commander.version', H)
        }),
        this
      )
    }
    description(H, _) {
      if (H === void 0 && _ === void 0) return this._description
      if (((this._description = H), _)) this._argsDescription = _
      return this
    }
    summary(H) {
      if (H === void 0) return this._summary
      return (this._summary = H), this
    }
    alias(H) {
      if (H === void 0) return this._aliases[0]
      let _ = this
      if (
        this.commands.length !== 0 &&
        this.commands[this.commands.length - 1]._executableHandler
      )
        _ = this.commands[this.commands.length - 1]
      if (H === _._name)
        throw Error("Command alias can't be the same as its name")
      let q = this.parent?._findCommand(H)
      if (q) {
        let K = [q.name()].concat(q.aliases()).join('|')
        throw Error(
          `cannot add alias '${H}' to command '${this.name()}' as already have command '${K}'`,
        )
      }
      return _._aliases.push(H), this
    }
    aliases(H) {
      if (H === void 0) return this._aliases
      return H.forEach(_ => this.alias(_)), this
    }
    usage(H) {
      if (H === void 0) {
        if (this._usage) return this._usage
        let _ = this.registeredArguments.map(q => {
          return LfO(q)
        })
        return []
          .concat(
            this.options.length || this._helpOption !== null ? '[options]' : [],
            this.commands.length ? '[command]' : [],
            this.registeredArguments.length ? _ : [],
          )
          .join(' ')
      }
      return (this._usage = H), this
    }
    name(H) {
      if (H === void 0) return this._name
      return (this._name = H), this
    }
    nameFromFilename(H) {
      return (this._name = kTH.basename(H, kTH.extname(H))), this
    }
    executableDir(H) {
      if (H === void 0) return this._executableDir
      return (this._executableDir = H), this
    }
    helpInformation(H) {
      let _ = this.createHelp()
      if (_.helpWidth === void 0)
        _.helpWidth =
          H && H.error
            ? this._outputConfiguration.getErrHelpWidth()
            : this._outputConfiguration.getOutHelpWidth()
      return _.formatHelp(this, _)
    }
    _getHelpContext(H) {
      H = H || {}
      let _ = { error: !!H.error },
        q
      if (_.error) q = K => this._outputConfiguration.writeErr(K)
      else q = K => this._outputConfiguration.writeOut(K)
      return (_.write = H.write || q), (_.command = this), _
    }
    outputHelp(H) {
      let _
      if (typeof H === 'function') (_ = H), (H = void 0)
      let q = this._getHelpContext(H)
      this._getCommandAndAncestors()
        .reverse()
        .forEach(O => O.emit('beforeAllHelp', q)),
        this.emit('beforeHelp', q)
      let K = this.helpInformation(q)
      if (_) {
        if (((K = _(K)), typeof K !== 'string' && !Buffer.isBuffer(K)))
          throw Error('outputHelp callback must return a string or a Buffer')
      }
      if ((q.write(K), this._getHelpOption()?.long))
        this.emit(this._getHelpOption().long)
      this.emit('afterHelp', q),
        this._getCommandAndAncestors().forEach(O => O.emit('afterAllHelp', q))
    }
    helpOption(H, _) {
      if (typeof H === 'boolean') {
        if (H) this._helpOption = this._helpOption ?? void 0
        else this._helpOption = null
        return this
      }
      return (
        (H = H ?? '-h, --help'),
        (_ = _ ?? 'display help for command'),
        (this._helpOption = this.createOption(H, _)),
        this
      )
    }
    _getHelpOption() {
      if (this._helpOption === void 0) this.helpOption(void 0, void 0)
      return this._helpOption
    }
    addHelpOption(H) {
      return (this._helpOption = H), this
    }
    help(H) {
      this.outputHelp(H)
      let _ = UW.exitCode || 0
      if (_ === 0 && H && typeof H !== 'function' && H.error) _ = 1
      this._exit(_, 'commander.help', '(outputHelp)')
    }
    addHelpText(H, _) {
      let q = ['beforeAll', 'before', 'after', 'afterAll']
      if (!q.includes(H))
        throw Error(`Unexpected value for position to addHelpText.
Expecting one of '${q.join("', '")}'`)
      let K = `${H}Help`
      return (
        this.on(K, O => {
          let T
          if (typeof _ === 'function')
            T = _({ error: O.error, command: O.command })
          else T = _
          if (T)
            O.write(`${T}
`)
        }),
        this
      )
    }
    _outputHelpIfRequested(H) {
      let _ = this._getHelpOption()
      if (_ && H.find(K => _.is(K)))
        this.outputHelp(),
          this._exit(0, 'commander.helpDisplayed', '(outputHelp)')
    }
  }
  function M84(H) {
    return H.map(_ => {
      if (!_.startsWith('--inspect')) return _
      let q,
        K = '127.0.0.1',
        O = '9229',
        T
      if ((T = _.match(/^(--inspect(-brk)?)$/)) !== null) q = T[1]
      else if ((T = _.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null)
        if (((q = T[1]), /^\d+$/.test(T[3]))) O = T[3]
        else K = T[3]
      else if (
        (T = _.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null
      )
        (q = T[1]), (K = T[3]), (O = T[4])
      if (q && O !== '0') return `${q}=${K}:${parseInt(O) + 1}`
      return _
    })
  }
  D84.Command = T9q
})
var Z84 = i(Fl => {
  var { Argument: X84 } = Ih6(),
    { Command: z9q } = f84(),
    { CommanderError: NfO, InvalidArgumentError: P84 } = ry_(),
    { Help: vfO } = eqq(),
    { Option: W84 } = _9q()
  Fl.program = new z9q()
  Fl.createCommand = H => new z9q(H)
  Fl.createOption = (H, _) => new W84(H, _)
  Fl.createArgument = (H, _) => new X84(H, _)
  Fl.Command = z9q
  Fl.Option = W84
  Fl.Argument = X84
  Fl.Help = vfO
  Fl.CommanderError = NfO
  Fl.InvalidArgumentError = P84
  Fl.InvalidOptionArgumentError = P84
})
var R84 = i(($F, G84) => {
  var Es = Z84()
  $F = G84.exports = {}
  $F.program = new Es.Command()
  $F.Argument = Es.Argument
  $F.Command = Es.Command
  $F.CommanderError = Es.CommanderError
  $F.Help = Es.Help
  $F.InvalidArgumentError = Es.InvalidArgumentError
  $F.InvalidOptionArgumentError = Es.InvalidArgumentError
  $F.Option = Es.Option
  $F.createCommand = H => new Es.Command(H)
  $F.createOption = (H, _) => new Es.Option(H, _)
  $F.createArgument = (H, _) => new Es.Argument(H, _)
})
var L84, rPj, oPj, aPj, sPj, tPj, k84, ePj, V84, H2j, i4, _2j
var bh6 = R(() => {
  ;(L84 = p(R84(), 1)),
    ({
      program: rPj,
      createCommand: oPj,
      createArgument: aPj,
      createOption: sPj,
      CommanderError: tPj,
      InvalidArgumentError: k84,
      InvalidOptionArgumentError: ePj,
      Command: V84,
      Argument: H2j,
      Option: i4,
      Help: _2j,
    } = L84.default)
})
function $9q(H, _) {
  let q = Math.max(_, 1),
    K = []
  for (let O of H.split(`
`)) {
    let T = O.match(/\s*\S+/g)
    if (!T) {
      K.push('')
      continue
    }
    let z = '',
      $ = 0,
      Y = !1
    for (let A of T) {
      let w = a_(A)
      if (!Y) (z = A), ($ = w), (Y = !0)
      else if ($ + w <= q) (z += A), ($ += w)
      else {
        K.push(z)
        let j = A.replace(/^\s+/, '')
        ;(z = j), ($ = a_(j))
      }
    }
    K.push(z)
  }
  return K.join(`
`)
}
function xh6(H, _, q, K) {
  let O = ' '.repeat(oy_)
  if (!_) return O + H
  let T = a_(H)
  if (
    _.includes(`
`)
  ) {
    let w = T <= q ? ' '.repeat(q - T + ay_) : ' '.repeat(ay_)
    return (O + H + w + _).replace(
      /\n/g,
      `
` + O,
    )
  }
  let z = K - oy_ - q - ay_
  if (T <= q && z >= hfO) {
    let w = ' '.repeat(q - T + ay_),
      j = ' '.repeat(oy_ + q + ay_),
      J = $9q(_, z)
    return (
      O +
      H +
      w +
      J.replace(
        /\n/g,
        `
` + j,
      )
    )
  }
  let $ = ' '.repeat(oy_ + N84),
    Y = K - oy_ - N84,
    A = $9q(_, Y)
  return (
    O +
    H +
    `
` +
    $ +
    A.replace(
      /\n/g,
      `
` + $,
    )
  )
}
function uh6(H, _, q) {
  if (q.length === 0) return
  H.push(_, ...q, '')
}
function EfO(H, _) {
  let q = _.helpWidth || 80,
    K = Math.min(_.padWidth(H, _), yfO),
    O = [`Usage: ${_.commandUsage(H)}`, ''],
    T = _.commandDescription(H)
  if (T.length > 0) O.push($9q(T, q), '')
  if (
    (uh6(
      O,
      'Arguments:',
      _.visibleArguments(H).map(z =>
        xh6(_.argumentTerm(z), _.argumentDescription(z), K, q),
      ),
    ),
    uh6(
      O,
      'Options:',
      _.visibleOptions(H).map(z =>
        xh6(_.optionTerm(z), _.optionDescription(z), K, q),
      ),
    ),
    _.showGlobalOptions)
  )
    uh6(
      O,
      'Global Options:',
      _.visibleGlobalOptions(H).map(z =>
        xh6(_.optionTerm(z), _.optionDescription(z), K, q),
      ),
    )
  return (
    uh6(
      O,
      'Commands:',
      _.visibleCommands(H).map(z =>
        xh6(_.subcommandTerm(z), _.subcommandDescription(z), K, q),
      ),
    ),
    O.join(`
`)
  )
}
function VTH() {
  let H = _ => _.long?.replace(/^--/, '') ?? _.short?.replace(/^-/, '') ?? ''
  return Object.assign(
    { sortSubcommands: !0, sortOptions: !0, formatHelp: EfO },
    { compareOptions: (_, q) => H(_).localeCompare(H(q)) },
  )
}
var oy_ = 2,
  ay_ = 2,
  yfO = 36,
  hfO = 30,
  N84 = 4
var mh6 = R(() => {
  O4()
})
function Bq(H) {
  if (H) console.error(D_.red(H))
  TP('cli_error'), process.exit(1)
  return
}
function Hj(H) {
  if (H)
    process.stdout.write(
      H +
        `
`,
    )
  process.exit(0)
  return
}
function Ss(H) {
  process.stderr.write(
    D_.yellow(H) +
      `
`,
  )
}
var YF = R(() => {
  F4()
  Ln()
})
function v84(H) {
  H.command('add <name> <commandOrUrl> [args...]')
    .description(`Add an MCP server to Claude Code.

Examples:
  # Add HTTP server:
  claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

  # Add HTTP server with headers:
  claude mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."

  # Add stdio server with environment variables:
  claude mcp add my-server -e API_KEY=xxx -- npx my-mcp-server

  # Add stdio server with subprocess flags:
  claude mcp add my-server -- my-command --some-flag arg1`)
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .option(
      '-t, --transport <transport>',
      'Transport type (stdio, sse, http). Defaults to stdio if not specified.',
    )
    .option(
      '-e, --env <env...>',
      'Set environment variables (e.g. -e KEY=value)',
    )
    .option(
      '-H, --header <header...>',
      'Set WebSocket headers (e.g. -H "X-Api-Key: abc123" -H "X-Custom: value")',
    )
    .option('--client-id <clientId>', 'OAuth client ID for HTTP/SSE servers')
    .option(
      '--client-secret',
      'Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)',
    )
    .option(
      '--callback-port <port>',
      'Fixed port for OAuth callback (for servers requiring pre-registered redirect URIs)',
    )
    .helpOption('-h, --help', 'Display help for command')
    .addOption(
      new i4(
        '--xaa',
        "Enable XAA (SEP-990) for this server. Requires 'claude mcp xaa setup' first. Also requires --client-id and --client-secret (for the MCP server's AS).",
      ).hideHelp(!z6H()),
    )
    .action(async (_, q, K, O) => {
      let T = q,
        z = K
      if (!_)
        Bq(`Error: Server name is required.
Usage: claude mcp add <name> <command> [args...]`)
      else if (!T)
        Bq(`Error: Command is required when server name is provided.
Usage: claude mcp add <name> <command> [args...]`)
      try {
        let $ = OrH(O.scope),
          Y = YV7(O.transport)
        if (O.xaa && !z6H())
          Bq(
            'Error: --xaa requires CLAUDE_CODE_ENABLE_XAA=1 in your environment',
          )
        let A = Boolean(O.xaa)
        if (A) {
          let J = []
          if (!O.clientId) J.push('--client-id')
          if (!O.clientSecret) J.push('--client-secret')
          if (!$6H())
            J.push("'claude mcp xaa setup' (settings.xaaIdp not configured)")
          if (J.length) Bq(`Error: --xaa requires: ${J.join(', ')}`)
        }
        let w = O.transport !== void 0,
          j =
            T.startsWith('http://') ||
            T.startsWith('https://') ||
            T.startsWith('localhost') ||
            T.endsWith('/sse') ||
            T.endsWith('/mcp')
        if (
          (c('tengu_mcp_add', {
            type: Y,
            scope: $,
            source: 'command',
            transport: Y,
            transportExplicit: w,
            looksLikeUrl: j,
          }),
          Y === 'sse')
        ) {
          if (!T) Bq('Error: URL is required for SSE transport.')
          let J = O.header ? YN8(O.header) : void 0,
            M = O.callbackPort ? parseInt(O.callbackPort, 10) : void 0,
            D =
              O.clientId || M || A
                ? {
                    ...(O.clientId && { clientId: O.clientId }),
                    ...(M && { callbackPort: M }),
                    ...(A && { xaa: !0 }),
                  }
                : void 0,
            f = O.clientSecret && O.clientId ? await Kk_() : void 0,
            X = { type: 'sse', url: T, headers: J, oauth: D }
          if ((await qDH(_, X, $), f)) {
            let P = await Ok_(_, X, f)
            if (!P.success)
              process.stderr.write(`Server added, but the client secret could not be stored${P.warning ? ` (${P.warning})` : ''}. Re-run with --client-secret once secure storage is available.
`)
          }
          if (
            (process.stdout.write(`Added SSE MCP server ${_} with URL: ${T} to ${$} config
`),
            J)
          )
            process.stdout.write(`Headers: ${CH(J, null, 2)}
`)
        } else if (Y === 'http') {
          if (!T) Bq('Error: URL is required for HTTP transport.')
          let J = O.header ? YN8(O.header) : void 0,
            M = O.callbackPort ? parseInt(O.callbackPort, 10) : void 0,
            D =
              O.clientId || M || A
                ? {
                    ...(O.clientId && { clientId: O.clientId }),
                    ...(M && { callbackPort: M }),
                    ...(A && { xaa: !0 }),
                  }
                : void 0,
            f = O.clientSecret && O.clientId ? await Kk_() : void 0,
            X = { type: 'http', url: T, headers: J, oauth: D }
          if ((await qDH(_, X, $), f)) {
            let P = await Ok_(_, X, f)
            if (!P.success)
              process.stderr.write(`Server added, but the client secret could not be stored${P.warning ? ` (${P.warning})` : ''}. Re-run with --client-secret once secure storage is available.
`)
          }
          if (
            (process.stdout.write(`Added HTTP MCP server ${_} with URL: ${T} to ${$} config
`),
            J)
          )
            process.stdout.write(`Headers: ${CH(J, null, 2)}
`)
        } else {
          if (O.clientId || O.clientSecret || O.callbackPort || O.xaa)
            process.stderr.write(`Warning: --client-id, --client-secret, --callback-port, and --xaa are only supported for HTTP/SSE transports and will be ignored for stdio.
`)
          if (!w && j)
            process.stderr.write(`
Warning: The command "${T}" looks like a URL, but is being interpreted as a stdio server as --transport was not specified.
`),
              process.stderr.write(`If this is an HTTP server, use: claude mcp add --transport http ${_} ${T}
`),
              process.stderr.write(`If this is an SSE server, use: claude mcp add --transport sse ${_} ${T}
`)
          let J = A$q(O.env)
          await qDH(_, { type: 'stdio', command: T, args: z, env: J }, $),
            process.stdout.write(`Added stdio MCP server ${_} with command: ${T} ${z.join(' ')} to ${$} config
`)
        }
        Hj(`File modified: ${HI($)}`)
      } catch ($) {
        Bq(LH($))
      }
    })
}
var y84 = R(() => {
  bh6()
  YF()
  N_()
  _qH()
  OL()
  lk()
  eiH()
  c_()
  W_()
  i_()
})
function h84(H) {
  let _ = H.command('xaa').description(
    'Manage the XAA (SEP-990) IdP connection',
  )
  _.command('setup')
    .description(
      'Configure the IdP connection (one-time setup for all XAA-enabled servers)',
    )
    .requiredOption('--issuer <url>', 'IdP issuer URL (OIDC discovery)')
    .requiredOption('--client-id <id>', "Claude Code's client_id at the IdP")
    .option(
      '--client-secret',
      'Read IdP client secret from MCP_XAA_IDP_CLIENT_SECRET env var',
    )
    .option(
      '--callback-port <port>',
      'Fixed loopback callback port (only if IdP does not honor RFC 8252 port-any matching)',
    )
    .action(async q => {
      let K
      try {
        K = new URL(q.issuer)
      } catch {
        return Bq(`Error: --issuer must be a valid URL (got "${q.issuer}")`)
      }
      if (
        K.protocol !== 'https:' &&
        !(
          K.protocol === 'http:' &&
          (K.hostname === 'localhost' ||
            K.hostname === '127.0.0.1' ||
            K.hostname === '[::1]')
        )
      )
        return Bq(
          `Error: --issuer must use https:// (got "${K.protocol}//${K.host}")`,
        )
      let O = q.callbackPort ? parseInt(q.callbackPort, 10) : void 0
      if (O !== void 0 && (!Number.isInteger(O) || O <= 0))
        return Bq('Error: --callback-port must be a positive integer')
      let T = q.clientSecret ? process.env.MCP_XAA_IDP_CLIENT_SECRET : void 0
      if (q.clientSecret && !T)
        return Bq(
          'Error: --client-secret requires MCP_XAA_IDP_CLIENT_SECRET env var',
        )
      let z = $6H(),
        $ = z?.issuer,
        Y = z?.clientId,
        { error: A } = g8('userSettings', {
          xaaIdp: { issuer: q.issuer, clientId: q.clientId, callbackPort: O },
        })
      if (A) return Bq(`Error writing settings: ${A.message}`)
      if ($) {
        if (v5H($) !== v5H(q.issuer)) await HDH($), await oT6($)
        else if (Y !== q.clientId) await HDH($), await oT6($)
      }
      if (T) {
        let { success: w, warning: j } = await ek7(q.issuer, T)
        if (!w)
          return Bq(
            `Error: settings written but keychain save failed${j ? ` \u2014 ${j}` : ''}. Re-run with --client-secret once keychain is available.`,
          )
      }
      Hj(`XAA IdP connection configured for ${q.issuer}`)
    }),
    _.command('login')
      .description(
        'Cache an IdP id_token so XAA-enabled MCP servers authenticate silently. Default: run the OIDC browser login. With --id-token: write a pre-obtained JWT directly (used by conformance/e2e tests where the mock IdP does not serve /authorize).',
      )
      .option(
        '--force',
        'Ignore any cached id_token and re-login (useful after IdP-side revocation)',
      )
      .option(
        '--id-token <jwt>',
        'Write this pre-obtained id_token directly to cache, skipping the OIDC browser login',
      )
      .action(async q => {
        let K = $6H()
        if (!K)
          return Bq(
            "Error: no XAA IdP connection. Run 'claude mcp xaa setup' first.",
          )
        if (q.idToken)
          try {
            let T = await tk7(K.issuer, q.idToken)
            return Hj(
              `id_token cached for ${K.issuer} (expires ${new Date(T).toISOString()})`,
            )
          } catch (T) {
            return Bq(`id_token cache write failed: ${LH(T)}`)
          }
        if (q.force) await HDH(K.issuer)
        if ((await AvH(K.issuer)) !== void 0)
          return Hj(
            `Already logged in to ${K.issuer} (cached id_token still valid). Use --force to re-login.`,
          )
        process.stdout.write(`Opening browser for IdP login at ${K.issuer}\u2026
`)
        try {
          await sT6({
            idpIssuer: K.issuer,
            idpClientId: K.clientId,
            idpClientSecret: await tiH(K.issuer),
            callbackPort: K.callbackPort,
            onAuthorizationUrl: T => {
              process.stdout.write(`If the browser did not open, visit:
  ${T}
`)
            },
          }),
            Hj(
              'Logged in. MCP servers with --xaa will now authenticate silently.',
            )
        } catch (T) {
          Bq(`IdP login failed: ${LH(T)}`)
        }
      }),
    _.command('show')
      .description('Show the current IdP connection config')
      .action(async () => {
        let q = $6H()
        if (!q) return Hj('No XAA IdP connection configured.')
        let K = (await tiH(q.issuer)) !== void 0,
          O = (await AvH(q.issuer)) !== void 0
        if (
          (process.stdout.write(`Issuer:        ${q.issuer}
`),
          process.stdout.write(`Client ID:     ${q.clientId}
`),
          q.callbackPort !== void 0)
        )
          process.stdout.write(`Callback port: ${q.callbackPort}
`)
        process.stdout.write(`Client secret: ${K ? '(stored in keychain)' : '(not set \u2014 PKCE-only)'}
`),
          process.stdout.write(`Logged in:     ${O ? 'yes (id_token cached)' : "no \u2014 run 'claude mcp xaa login'"}
`),
          Hj()
      }),
    _.command('clear')
      .description('Clear the IdP connection config and cached id_token')
      .action(async () => {
        let q = $6H(),
          { error: K } = g8('userSettings', { xaaIdp: void 0 })
        if (K) return Bq(`Error writing settings: ${K.message}`)
        if (q) await HDH(q.issuer), await oT6(q.issuer)
        Hj('XAA IdP connection cleared')
      })
}
var E84 = R(() => {
  YF()
  eiH()
  W_()
  M8()
})
function C84(H) {
  let _ = S84.c(36),
    { servers: q, scope: K, onDone: O } = H,
    T
  if (_[0] !== q) (T = Object.keys(q)), (_[0] = q), (_[1] = T)
  else T = _[1]
  let z = T,
    $
  if (_[2] === Symbol.for('react.memo_cache_sentinel')) ($ = {}), (_[2] = $)
  else $ = _[2]
  let [Y, A] = _y.useState($),
    w,
    j
  if (_[3] === Symbol.for('react.memo_cache_sentinel'))
    (w = () => {
      A6H().then(x => {
        let { servers: U } = x
        return A(U)
      })
    }),
      (j = []),
      (_[3] = w),
      (_[4] = j)
  else (w = _[3]), (j = _[4])
  _y.useEffect(w, j)
  let J
  if (_[5] !== Y || _[6] !== z)
    (J = z.filter(x => Y[x] !== void 0)), (_[5] = Y), (_[6] = z), (_[7] = J)
  else J = _[7]
  let M = J,
    D = async function (U) {
      let g = 0
      for (let Q of U) {
        let l = q[Q]
        if (l) {
          let d = Q
          if (Y[d] !== void 0) {
            let r = 1
            while (Y[`${Q}_${r}`] !== void 0) r++
            d = `${Q}_${r}`
          }
          await qDH(d, l, K), g++
        }
      }
      P(g)
    },
    [f] = i7(),
    X
  if (_[8] !== O || _[9] !== K || _[10] !== f)
    (X = x => {
      if (x > 0)
        q7(`
${Lq('success', f)(`Successfully imported ${x} MCP ${N6(x, 'server')} to ${K} config.`)}
`)
      else
        q7(`
No servers were imported.`)
      O(), O7()
    }),
      (_[8] = O),
      (_[9] = K),
      (_[10] = f),
      (_[11] = X)
  else X = _[11]
  let P = X,
    G
  if (_[12] !== P)
    (G = () => {
      P(0)
    }),
      (_[12] = P),
      (_[13] = G)
  else G = _[13]
  let W = G,
    Z = z.length,
    L
  if (_[14] !== z.length)
    (L = N6(z.length, 'server')), (_[14] = z.length), (_[15] = L)
  else L = _[15]
  let k = `Found ${Z} MCP ${L} in Claude Desktop.`,
    v
  if (_[16] !== M.length)
    (v =
      M.length > 0 &&
      _y.default.createElement(
        V,
        { color: 'warning' },
        'Note: Some servers already exist with the same name. If selected, they will be imported with a numbered suffix.',
      )),
      (_[16] = M.length),
      (_[17] = v)
  else v = _[17]
  let E
  if (_[18] === Symbol.for('react.memo_cache_sentinel'))
    (E = _y.default.createElement(
      V,
      null,
      'Please select the servers you want to import:',
    )),
      (_[18] = E)
  else E = _[18]
  let h, C
  if (_[19] !== M || _[20] !== z)
    (h = z.map(x => ({
      label: `${x}${M.includes(x) ? ' (already exists)' : ''}`,
      value: x,
    }))),
      (C = z.filter(x => !M.includes(x))),
      (_[19] = M),
      (_[20] = z),
      (_[21] = h),
      (_[22] = C)
  else (h = _[21]), (C = _[22])
  let I
  if (_[23] !== W || _[24] !== D || _[25] !== h || _[26] !== C)
    (I = _y.default.createElement(HPH, {
      options: h,
      defaultValue: C,
      onSubmit: D,
      onCancel: W,
      hideIndexes: !0,
    })),
      (_[23] = W),
      (_[24] = D),
      (_[25] = h),
      (_[26] = C),
      (_[27] = I)
  else I = _[27]
  let b
  if (_[28] !== W || _[29] !== k || _[30] !== v || _[31] !== I)
    (b = _y.default.createElement(
      b6,
      {
        title: 'Import MCP Servers from Claude Desktop',
        subtitle: k,
        color: 'success',
        onCancel: W,
        hideInputGuide: !0,
      },
      v,
      E,
      I,
    )),
      (_[28] = W),
      (_[29] = k),
      (_[30] = v),
      (_[31] = I),
      (_[32] = b)
  else b = _[32]
  let m
  if (_[33] === Symbol.for('react.memo_cache_sentinel'))
    (m = _y.default.createElement(
      B,
      { paddingX: 1 },
      _y.default.createElement(
        V,
        { dimColor: !0, italic: !0 },
        _y.default.createElement(
          Y6,
          null,
          _y.default.createElement(z_, { chord: 'space', action: 'select' }),
          _y.default.createElement(z_, { chord: 'enter', action: 'confirm' }),
          _y.default.createElement(o6, {
            action: 'confirm:no',
            context: 'Confirmation',
            fallback: 'Esc',
            description: 'cancel',
          }),
        ),
      ),
    )),
      (_[33] = m)
  else m = _[33]
  let S
  if (_[34] !== b)
    (S = _y.default.createElement(_y.default.Fragment, null, b, m)),
      (_[34] = b),
      (_[35] = S)
  else S = _[35]
  return S
}
var S84, _y
var I84 = R(() => {
  pT()
  mL()
  iH()
  OL()
  R8()
  E4()
  pV_()
  A9()
  g9()
  Pq()
  ;(S84 = p(q_(), 1)), (_y = p(PH(), 1))
})
function ph6() {
  O6(H => ({ ...H, iterm2SetupInProgress: !1 }))
}
function SfO() {
  let H = b_()
  return {
    inProgress: H.iterm2SetupInProgress ?? !1,
    backupPath: H.iterm2BackupPath || null,
  }
}
function CfO() {
  return x84.join(
    b84.homedir(),
    'Library',
    'Preferences',
    'com.googlecode.iterm2.plist',
  )
}
async function u84() {
  let { inProgress: H, backupPath: _ } = SfO()
  if (!H) return { status: 'no_backup' }
  if (!_) return ph6(), { status: 'no_backup' }
  try {
    await Bh6.stat(_)
  } catch {
    return ph6(), { status: 'no_backup' }
  }
  try {
    return await Bh6.copyFile(_, CfO()), ph6(), { status: 'restored' }
  } catch (q) {
    return (
      N(`Failed to restore iTerm2 settings with: ${q}`, { level: 'error' }),
      ph6(),
      { status: 'failed', backupPath: _ }
    )
  }
}
var Bh6, b84, x84
var m84 = R(() => {
  n6()
  lH()
  ;(Bh6 = require('fs/promises')),
    (b84 = require('os')),
    (x84 = require('path'))
})
var Fh6 = {}
f_(Fh6, { setup: () => IfO, isDesktopEntrypointExempted: () => bfO })
async function IfO(H, _, q, K, O, T, z, $, Y) {
  v6('info', 'setup_started')
  let A = process.version.match(/^v(\d+)\./)?.[1]
  if (!A || parseInt(A) < 18)
    console.error(
      D_.bold.red('Error: Claude Code requires Node.js version 18 or higher.'),
    ),
      process.exit(1)
  if (z) KR(RX(z))
  if (!B4() || Y !== void 0);
  if (process.env.CLAUDE_BG_BACKEND === 'daemon') {
    let { startRendezvousServer: D } = await Promise.resolve().then(
      () => (jV_(), cn8),
    )
    D()
  }
  if (x7()) {
    let { captureTeammateModeSnapshot: D } = await Promise.resolve().then(
      () => (qEH(), ZB8),
    )
    D()
  }
  if (!S8()) {
    if (x7()) {
      let D = await u84()
      if (D.status === 'restored')
        console.log(
          D_.yellow(
            'Detected an interrupted iTerm2 setup. Your original settings have been restored. You may need to restart iTerm2 for the changes to take effect.',
          ),
        )
      else if (D.status === 'failed')
        console.error(
          D_.red(
            `Failed to restore iTerm2 settings. Please manually restore your original settings with: defaults import com.googlecode.iterm2 ${D.backupPath}.`,
          ),
        )
    }
    try {
      let D = await r96()
      if (D.status === 'restored')
        console.log(
          D_.yellow(
            'Detected an interrupted Terminal.app setup. Your original settings have been restored. You may need to restart Terminal.app for the changes to take effect.',
          ),
        )
      else if (D.status === 'failed')
        console.error(
          D_.red(
            `Failed to restore Terminal.app settings. Please manually restore your original settings with: defaults import com.apple.Terminal ${D.backupPath}.`,
          ),
        )
    } catch (D) {
      hH(D)
    }
  }
  try {
    MM(H)
  } catch (D) {
    process.stderr.write(
      D_.red(`Error: Can't access working directory ${D_.bold(H)}: ${LH(D)}
`),
    ),
      TP('setcwd'),
      process.exit(1)
  }
  let w = Date.now()
  if (
    (jU9(),
    v6('info', 'setup_hooks_captured', { duration_ms: Date.now() - w }),
    !F8())
  )
    XL7(H)
  if (K) {
    let D = E4H(),
      f = await cD()
    if (!D && !f)
      process.stderr.write(
        D_.red(`Error: Can only use --worktree in a git repository, but ${D_.bold(H)} is not a git repository. Configure a WorktreeCreate hook in settings.json to use --worktree with other VCS systems.
`),
      ),
        process.exit(1)
    let X = $ ? `pr-${$}` : (O ?? ZXH()),
      P
    if (f) {
      let W = T$(S_())
      if (!W)
        process.stderr.write(
          D_.red(`Error: Could not determine the main git repository root.
`),
        ),
          process.exit(1)
      if (K3_(S_()))
        v6('info', 'worktree_resolved_to_main_repo'), process.chdir(W), MM(W)
      P = T ? Gh6(W, YIH(X)) : void 0
    } else P = T ? Gh6(S_(), YIH(X)) : void 0
    let G
    try {
      G = await iR_(h_(), X, P, $ ? { prNumber: $ } : void 0)
    } catch (W) {
      process.stderr.write(
        D_.red(`Error creating worktree: ${LH(W)}
`),
      ),
        TP('worktree_create'),
        process.exit(1)
    }
    if ((c('tengu_worktree_created', { tmux_enabled: T }), T && P)) {
      let W = await vqq(P, G.worktreePath)
      if (W.created)
        console.log(
          D_.green(`Created tmux session: ${D_.bold(P)}
To attach: ${D_.bold(`tmux attach -t ${P}`)}`),
        )
      else
        console.error(
          D_.yellow(`Warning: Failed to create tmux session: ${W.error}`),
        )
    }
    process.chdir(G.worktreePath),
      MM(G.worktreePath),
      Xy(S_()),
      g9H(S_()),
      du(G),
      rR(),
      VwH()
  }
  if ((v6('info', 'setup_background_jobs_starting'), !B4()));
  gyH(),
    v6('info', 'setup_background_jobs_launched'),
    L7('setup_before_prefetch'),
    v6('info', 'setup_prefetch_starting')
  let j = (S8() && xH(process.env.CLAUDE_CODE_SYNC_PLUGIN_INSTALL)) || B4()
  if (!j) IX(a4())
  if (
    (Promise.resolve()
      .then(() => (qvH(), JV8))
      .then(D => {
        if (!j) D.loadPluginHooks(), D.setupPluginHookHotReload()
      }),
    !B4())
  ) {
    if (
      (Promise.resolve()
        .then(() => (kl8(), h2K))
        .then(D => D.registerSessionFileAccessHooks()),
      !F8() && L3())
    )
      Promise.resolve()
        .then(() => (cG6(), dG6))
        .then(D => D.startMemoryWatcher())
  }
  Y6q(), c('tengu_started', {}), ez8(S8())
  let J = (Gq() || {}).proxyAuthHelper
  if (
    ($H8({
      helper: J,
      fromProjectOrLocal:
        S6('projectSettings')?.proxyAuthHelper === J ||
        S6('localSettings')?.proxyAuthHelper === J,
      trustAccepted: L3,
    }),
    AH8(),
    L7('setup_after_prefetch'),
    !B4())
  )
    await fxK(b_().lastReleaseNotesSeen)
  if (_ === 'bypassPermissions' || q) {
    if (
      typeof process.getuid === 'function' &&
      process.getuid() === 0 &&
      process.env.IS_SANDBOX !== '1' &&
      !xH(process.env.CLAUDE_CODE_BUBBLEWRAP)
    )
      console.error(
        '--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons',
      ),
        process.exit(1)
  }
  let M = fA()
  if (M.lastCost !== void 0 && M.lastDuration !== void 0)
    c('tengu_exit', {
      last_session_cost: M.lastCost,
      last_session_api_duration: M.lastAPIDuration,
      last_session_tool_duration: M.lastToolDuration,
      last_session_duration: M.lastDuration,
      last_session_lines_added: M.lastLinesAdded,
      last_session_lines_removed: M.lastLinesRemoved,
      last_session_total_input_tokens: M.lastTotalInputTokens,
      last_session_total_output_tokens: M.lastTotalOutputTokens,
      last_session_total_cache_creation_input_tokens:
        M.lastTotalCacheCreationInputTokens,
      last_session_total_cache_read_input_tokens:
        M.lastTotalCacheReadInputTokens,
      last_session_fps_average: M.lastFpsAverage,
      last_session_fps_low_1_pct: M.lastFpsLow1Pct,
      last_session_graceful_shutdown: M.lastGracefulShutdown ?? !1,
      last_session_version_base: M.lastVersionBase ?? 'unknown',
      last_session_id: M.lastSessionId,
      ...M.lastSessionMetrics,
    })
}
function bfO(H) {
  return !1
}
var gh6 = R(() => {
  F4()
  N_()
  Dq()
  M6_()
  Gv()
  rCH()
  J_()
  mT()
  Ln()
  cP()
  gw()
  rD8()
  jq()
  wW()
  n6()
  O$()
  Qn()
  d3()
  pp()
  c_()
  W_()
  JK()
  gX_()
  XQH()
  _x()
  m84()
  W6()
  Sc()
  A2()
  MA()
  YK()
  M8()
  qb()
  u0()
})
var B84 = {}
f_(B84, { startMCPServer: () => ufO, createMCPServer: () => p84 })
async function ufO(H, _, q) {
  MM(H)
  let K = p84(_, q),
    O = new U0H()
  await K.connect(O)
}
function p84(H, _) {
  WMK(iQ8())
  let K = Cx(100),
    O = new R7H(
      {
        name: 'claude/tengu',
        version: {
          ISSUES_EXPLAINER:
            'report the issue at https://github.com/anthropics/claude-code/issues',
          PACKAGE_URL: '@anthropic-ai/claude-code',
          README_URL: 'https://code.claude.com/docs/en/overview',
          VERSION: '2.1.153',
          FEEDBACK_CHANNEL: 'https://github.com/anthropics/claude-code/issues',
          BUILD_TIME: '2026-05-27T20:03:21Z',
          GIT_SHA: '6cfd211761f355dcebba152b66399d0416e445d2',
        }.VERSION,
      },
      { capabilities: { tools: {} } },
    )
  return (
    O.setRequestHandler(zg, async () => {
      let T = nZ(),
        z = wV(T)
      return {
        tools: await Promise.all(
          z.map(async $ => ({
            ...$,
            description: await $.prompt({
              getToolPermissionContext: async () => T,
              tools: z,
              agents: [],
            }),
            inputSchema: CXH($.inputSchema),
            outputSchema: void 0,
          })),
        ),
      }
    }),
    O.setRequestHandler(gm, async ({ params: { name: T, arguments: z } }) => {
      let $ = nZ(),
        Y = wV($),
        A = Z4(Y, T)
      if (!A) throw Error(`Tool ${T} not found`)
      let w = {
        abortController: CK(),
        messageQueue: ZA,
        options: {
          commands: xfO,
          tools: Y,
          mainLoopModel: F7(),
          thinkingConfig: { type: 'disabled' },
          mcpClients: [],
          mcpResources: {},
          isNonInteractiveSession: !0,
          debug: H,
          verbose: _,
          agentDefinitions: { activeAgents: [], allAgents: [] },
        },
        getAppState: () => Hc(),
        setAppState: () => {},
        getMcp: () => Hc().mcp,
        getWebBrowser: () => Hc().webBrowser,
        setToolPermissionContext: () => {},
        taskRegistry: h6_,
        sessionHooksRegistry: oV6,
        getReplContexts: () => ({}),
        setReplContext: () => {},
        setWebBrowserSlice: () => {},
        agentLifecycle: rV6,
        teammateColors: aV6,
        messages: [],
        turnStartIndex: 0,
        readFileState: K,
        getFileHistoryState: () => {
          return
        },
        applyFileHistoryOp: () => {},
        applyAttributionOp: () => {},
      }
      try {
        if (!A.isEnabled()) {
          let M = `Tool ${T} is not enabled`
          return (
            N(`MCP server: ${M}`, { level: 'error' }),
            { isError: !0, content: [{ type: 'text', text: M }] }
          )
        }
        let j = await A.validateInput?.(z ?? {}, w)
        if (j && !j.result) {
          let M = `Tool ${T} input is invalid: ${j.message}`
          return (
            N(`MCP server: ${M}`, { level: 'error' }),
            { isError: !0, content: [{ type: 'text', text: M }] }
          )
        }
        let J = await A.call(z ?? {}, w, yW, kf({ content: [] }))
        return {
          content: [
            { type: 'text', text: typeof J === 'string' ? J : CH(J.data) },
          ],
        }
      } catch (j) {
        let M =
          (j instanceof Error ? hF8(j) : [String(j)])
            .filter(Boolean)
            .join(`
`)
            .trim() || 'Error'
        if (j instanceof zT || j instanceof cV || j instanceof e_H)
          N(`MCP server tool call '${T}' failed: ${M}`, { level: 'error' })
        else hH(j)
        return { isError: !0, content: [{ type: 'text', text: M }] }
      }
    }),
    O
  )
}
var xfO
var U84 = R(() => {
  o1_()
  Rp_()
  nf()
  OU()
  nNH()
  _e8()
  p9()
  SMH()
  RG()
  GA()
  v6_()
  lH()
  W_()
  TG()
  pt8()
  W6()
  f$()
  B8()
  mq()
  dw()
  Gv()
  i_()
  y6_()
  sV6()
  FR_()
  QZ6()
  xfO = [AN6]
})
var Q84 = {}
f_(Q84, {
  readClaudeDesktopMcpServers: () => mfO,
  getClaudeDesktopConfigPath: () => g84,
})
async function g84() {
  let H = n_()
  if (!Mn6.includes(H))
    throw Error(
      `Unsupported platform: ${H} - Claude Desktop integration only works on macOS and WSL.`,
    )
  if (H === 'macos')
    return Y9q.join(
      F84.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    )
  let _ = process.env.USERPROFILE
    ? process.env.USERPROFILE.replace(/\\/g, '/')
    : null
  if (_) {
    let K = `/mnt/c${_.replace(/^[A-Z]:/, '')}/AppData/Roaming/Claude/claude_desktop_config.json`
    try {
      return await JIH.stat(K), K
    } catch {}
  }
  try {
    try {
      let K = await JIH.readdir('/mnt/c/Users', { withFileTypes: !0 })
      for (let O of K) {
        if (
          O.name === 'Public' ||
          O.name === 'Default' ||
          O.name === 'Default User' ||
          O.name === 'All Users'
        )
          continue
        let T = Y9q.join(
          '/mnt/c/Users',
          O.name,
          'AppData',
          'Roaming',
          'Claude',
          'claude_desktop_config.json',
        )
        try {
          return await JIH.stat(T), T
        } catch {}
      }
    } catch {}
  } catch (q) {
    N(`Failed scanning /mnt/c/Users for Claude Desktop config: ${q}`, {
      level: 'error',
    })
  }
  throw Error(
    'Could not find Claude Desktop config file in Windows. Make sure Claude Desktop is installed on Windows.',
  )
}
async function mfO() {
  if (!Mn6.includes(n_()))
    throw Error(
      'Unsupported platform - Claude Desktop integration only works on macOS and WSL.',
    )
  try {
    let H = await g84(),
      _
    try {
      _ = await JIH.readFile(H, { encoding: 'utf8' })
    } catch (T) {
      if (f6(T) === 'ENOENT') return {}
      throw T
    }
    let q = V7(_)
    if (!q || typeof q !== 'object') return {}
    let K = q.mcpServers
    if (!K || typeof K !== 'object') return {}
    let O = {}
    for (let [T, z] of Object.entries(K)) {
      if (!z || typeof z !== 'object') continue
      let $ = Z3_().safeParse(z)
      if ($.success) O[T] = $.data
    }
    return O
  } catch (H) {
    return (
      N(`Failed to read Claude Desktop MCP servers: ${H}`, { level: 'error' }),
      {}
    )
  }
}
var JIH, F84, Y9q
var d84 = R(() => {
  U$H()
  lH()
  W_()
  W3()
  $9()
  ;(JIH = require('fs/promises')),
    (F84 = require('os')),
    (Y9q = require('path'))
})
var G2H = {}
f_(G2H, {
  mcpServeHandler: () => pfO,
  mcpResetChoicesHandler: () => nfO,
  mcpRemoveHandler: () => BfO,
  mcpListHandler: () => QfO,
  mcpGetHandler: () => dfO,
  mcpAddJsonHandler: () => cfO,
  mcpAddFromDesktopHandler: () => lfO,
})
async function i84(H, _) {
  try {
    let q = await kE(H, _)
    if (q.type === 'connected') return '\u2713 Connected'
    else if (q.type === 'needs-auth') return '! Needs authentication'
    else return '\u2717 Failed to connect'
  } catch (q) {
    return '\u2717 Connection error'
  }
}
async function pfO({ debug: H, verbose: _ }) {
  let q = n84.cwd()
  c('tengu_mcp_start', {})
  try {
    await l84.stat(q)
  } catch (K) {
    if (_7(K))
      uH('cli_mcp_serve', 'cli_mcp_serve_cwd_missing'),
        Bq(`Error: Directory ${q} does not exist`)
    throw K
  }
  try {
    let { setup: K } = await Promise.resolve().then(() => (gh6(), Fh6))
    await K(q, 'default', !1, !1, void 0, !1)
    let { startMCPServer: O } = await Promise.resolve().then(() => (U84(), B84))
    await O(q, H ?? !1, _ ?? !1), SH('cli_mcp_serve')
  } catch (K) {
    uH('cli_mcp_serve', 'cli_mcp_serve_start_failed'),
      Bq(`Error: Failed to start MCP server: ${K}`)
  }
}
async function BfO(H, _, q) {
  let K = ax(_),
    O = async () => {
      if (K && (K.type === 'sse' || K.type === 'http'))
        try {
          await zG6(_, K), await QDK(_, K)
        } catch ($) {
          N(`mcp remove: secure-storage cleanup for "${_}" failed: ${LH($)}`, {
            level: 'warn',
          })
        }
    },
    T
  try {
    if (q.scope) {
      let $ = OrH(q.scope)
      c('tengu_mcp_delete', { name: _, scope: $ }),
        await MN8(_, $),
        await O(),
        (T = $)
    } else {
      let $ = fA(),
        Y = b_(),
        A = await zP_().catch(() => ({})),
        w = Object.hasOwn(A, _),
        j = []
      if ($.mcpServers?.[_]) j.push('local')
      if (w) j.push('project')
      if (Y.mcpServers?.[_]) j.push('user')
      if (j.length === 0) {
        let J = [
            ...Object.keys($.mcpServers ?? {}),
            ...Object.keys(A),
            ...Object.keys(Y.mcpServers ?? {}),
          ],
          M = sq(J).sort()
        return (
          uH('cli_mcp_remove', 'cli_mcp_remove_not_found'),
          Bq(
            M.length > 0
              ? `No MCP server found with name: "${_}". Configured servers: ${M.join(', ')}`
              : `No MCP server found with name: "${_}". No MCP servers are configured.`,
          )
        )
      } else if (j.length === 1) {
        let J = j[0]
        c('tengu_mcp_delete', { name: _, scope: J }),
          await MN8(_, J),
          await O(),
          (T = J)
      } else
        return (
          process.stderr.write(`MCP server "${_}" exists in multiple scopes:
`),
          j.forEach(J => {
            process.stderr.write(`  - ${TP_(J)} (${HI(J)})
`)
          }),
          process.stderr.write(`
To remove from a specific scope, use:
`),
          j.forEach(J => {
            process.stderr.write(`  claude mcp remove "${_}" -s ${J}
`)
          }),
          uH('cli_mcp_remove', 'cli_mcp_remove_ambiguous_scope'),
          Bq()
        )
    }
  } catch ($) {
    return uH('cli_mcp_remove', 'cli_mcp_remove_failed'), Bq(LH($))
  }
  SH('cli_mcp_remove')
  let z = q.scope ? _ : `"${_}"`
  H.render(
    _j.default.createElement(
      SA,
      null,
      _j.default.createElement(
        B,
        { flexDirection: 'column' },
        _j.default.createElement(
          V,
          null,
          'Removed MCP server ',
          z,
          ' from ',
          T,
          ' config',
        ),
        _j.default.createElement(V, null, 'File modified: ', HI(T)),
      ),
    ),
  ),
    await H.waitUntilExit()
}
function UfO({ name: H, server: _, status: q }) {
  if (_.type === 'sse') return `${H}: ${_.url} (SSE) - ${q}`
  if (_.type === 'http') return `${H}: ${_.url} (HTTP) - ${q}`
  if (_.type === 'claudeai-proxy') return `${H}: ${_.url} - ${q}`
  if (!_.type || _.type === 'stdio') {
    let K = Array.isArray(_.args) ? _.args : []
    return `${H}: ${_.command} ${K.join(' ')} - ${q}`
  }
  return null
}
function FfO(H) {
  let _ = c84.c(10),
    { promise: q } = H,
    K = _j.use(q),
    O,
    T,
    z
  if (_[0] !== K) {
    let A = K.map(UfO).filter(gfO)
    ;(T = SA),
      (O = V),
      (z = A.join(`
`)),
      (_[0] = K),
      (_[1] = O),
      (_[2] = T),
      (_[3] = z)
  } else (O = _[1]), (T = _[2]), (z = _[3])
  let $
  if (_[4] !== O || _[5] !== z)
    ($ = _j.default.createElement(O, null, z)),
      (_[4] = O),
      (_[5] = z),
      (_[6] = $)
  else $ = _[6]
  let Y
  if (_[7] !== T || _[8] !== $)
    (Y = _j.default.createElement(T, null, $)),
      (_[7] = T),
      (_[8] = $),
      (_[9] = Y)
  else Y = _[9]
  return Y
}
function gfO(H) {
  return H !== null
}
async function QfO(H) {
  c('tengu_mcp_list', {})
  let { servers: _ } = await A6H()
  SH('cli_mcp_list')
  let q = _j.default.createElement(S__, null)
  if (Object.keys(_).length === 0) {
    H.render(
      _j.default.createElement(
        SA,
        null,
        _j.default.createElement(
          B,
          { flexDirection: 'column' },
          _j.default.createElement(
            V,
            null,
            'No MCP servers configured. Use `claude mcp add` to add a server.',
          ),
          q,
        ),
      ),
    ),
      await H.waitUntilExit(),
      await O7(0)
    return
  }
  let K = ar(
    Object.entries(_),
    async ([O, T]) => ({ name: O, server: T, status: await i84(O, T) }),
    { concurrency: Ek_() },
  )
  H.render(
    _j.default.createElement(
      _j.Suspense,
      {
        fallback: _j.default.createElement(
          V,
          null,
          'Checking MCP server health\u2026',
          `

`,
        ),
      },
      _j.default.createElement(
        B,
        { flexDirection: 'column' },
        _j.default.createElement(FfO, { promise: K }),
        q,
      ),
    ),
  ),
    await H.waitUntilExit(),
    await O7(0)
}
async function dfO(H,_){c("tengu_mcp_get",{name:_});let q=ax(_);if(!q){let{servers:T}=aw
