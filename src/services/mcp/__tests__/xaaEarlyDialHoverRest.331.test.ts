import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FileReadTool } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { Command } from '@commander-js/extra-typings'
import {
  type McpXaaDeps,
  registerMcpXaaCommands,
  runMcpXaaClear,
  runMcpXaaLogin,
  runMcpXaaSetup,
  runMcpXaaShow,
} from '../../../cli/handlers/mcpXaa.js'
import {
  type McpHttpServerHandle,
  startMCPServerHttp,
} from '../../../entrypoints/mcpHttpServer.js'
import {
  createHoverRestBackend,
  createMemoryStorageV5Backend,
  recordHoverRestDecision,
  resetHoverRestPinForTests,
  resetPinnedStorageV5ForTests,
  tryCreateV5Backend,
} from '../../../utils/storageV5/index.js'
import {
  adoptEarlyDial,
  type EarlySessionTunnelDialHandle,
  EX_UNAVAILABLE,
  type SessionTunnelEnvelope,
  startEarlySessionTunnelDial,
  TOOL_SERVER_STARTING_BODY,
  TUNNEL_HOLD_CLOSE_CODE,
  TUNNEL_HOLD_MAX_BYTES,
  TUNNEL_HOLD_MAX_FRAMES,
} from '../sessionTunnel.js'
import {
  discoverOidc,
  issuerKey,
  saveIdpIdTokenFromJwt,
  type XaaIdpSettings,
} from '../xaaIdpLogin.js'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')

const tempDirs: string[] = []
const openHttpMcpHandles: McpHttpServerHandle[] = []
const openEarlyDials: EarlySessionTunnelDialHandle[] = []
const openNodeServers: HttpServer[] = []
const openBunServers: Array<{ stop: (closeActive?: boolean) => void }> = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function makeFakeJwt(expSeconds: number): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ sub: 'user-1', exp: expSeconds }),
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 3_000,
  intervalMs = 15,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`)
}

afterEach(async () => {
  resetHoverRestPinForTests()
  resetPinnedStorageV5ForTests()
  delete process.env.CLAUDE_CODE_HOVER_REST_URL
  delete process.env.CLAUDE_CODE_HOVER_REST_TOKEN

  while (openEarlyDials.length > 0) {
    openEarlyDials.pop()!.stop()
  }
  while (openHttpMcpHandles.length > 0) {
    await openHttpMcpHandles.pop()!.close()
  }
  while (openBunServers.length > 0) {
    openBunServers.pop()!.stop(true)
  }
  while (openNodeServers.length > 0) {
    const srv = openNodeServers.pop()!
    await new Promise<void>(resolveClose => srv.close(() => resolveClose()))
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
})

// ---------------------------------------------------------------------------
// 1. Official 2.1.331 `claude mcp xaa` CLI (`setup | login | show | clear`)
// ---------------------------------------------------------------------------

describe('2.1.331 claude mcp xaa CLI (chunk #2465)', () => {
  function createInMemoryXaaHarness(env: NodeJS.ProcessEnv = {}) {
    let settings: XaaIdpSettings | undefined
    const secrets = new Map<string, string>()
    const tokens = new Map<string, { jwt: string; expiresAt: number }>()
    const stdoutLines: string[] = []
    let acquireCalls = 0

    const deps: McpXaaDeps = {
      env,
      getXaaIdpSettings: () => settings,
      updateUserSettings: patch => {
        settings = patch.xaaIdp
        return { error: null }
      },
      getIdpClientSecret: issuer => secrets.get(issuerKey(issuer)),
      saveIdpClientSecret: (issuer, secret) => {
        secrets.set(issuerKey(issuer), secret)
        return { success: true }
      },
      clearIdpClientSecret: issuer => {
        secrets.delete(issuerKey(issuer))
      },
      getCachedIdpIdToken: issuer => {
        const entry = tokens.get(issuerKey(issuer))
        if (!entry || entry.expiresAt <= Date.now() + 60_000) return undefined
        return entry.jwt
      },
      saveIdpIdTokenFromJwt: (issuer, jwt) => {
        const expiresAt = Date.now() + 3600_000
        tokens.set(issuerKey(issuer), { jwt, expiresAt })
        return expiresAt
      },
      clearIdpIdToken: issuer => {
        tokens.delete(issuerKey(issuer))
      },
      acquireIdpIdToken: async opts => {
        acquireCalls += 1
        opts.onAuthorizationUrl?.(
          `${opts.idpIssuer}/authorize?client_id=${opts.idpClientId}`,
        )
        const jwt = makeFakeJwt(Math.floor(Date.now() / 1000) + 3600)
        tokens.set(issuerKey(opts.idpIssuer), {
          jwt,
          expiresAt: Date.now() + 3600_000,
        })
        return jwt
      },
      writeStdout: text => {
        stdoutLines.push(text)
      },
    }

    return {
      deps,
      getSettings: () => settings,
      secrets,
      tokens,
      stdoutLines,
      getAcquireCalls: () => acquireCalls,
    }
  }

  test('registers `claude mcp xaa` subcommands and wires registerMcpXaaCommands in src/main.tsx', () => {
    const mcp = new Command('mcp').exitOverride()
    const xaa = registerMcpXaaCommands(mcp)
    expect(xaa.name()).toBe('xaa')
    expect(xaa.description()).toBe('Manage the XAA (SEP-990) IdP connection')
    expect(xaa.commands.map(c => c.name())).toEqual([
      'setup',
      'login',
      'show',
      'clear',
    ])

    const setupCmd = xaa.commands.find(c => c.name() === 'setup')
    expect(setupCmd?.options.map(o => o.long)).toEqual(
      expect.arrayContaining([
        '--issuer',
        '--client-id',
        '--client-secret',
        '--callback-port',
      ]),
    )
    expect(setupCmd?.options.find(o => o.long === '--issuer')?.mandatory).toBe(
      true,
    )
    expect(
      setupCmd?.options.find(o => o.long === '--client-id')?.mandatory,
    ).toBe(true)

    const loginCmd = xaa.commands.find(c => c.name() === 'login')
    expect(loginCmd?.options.map(o => o.long)).toEqual(
      expect.arrayContaining(['--force', '--id-token']),
    )

    const mainSrc = readFileSync(join(REPO_ROOT, 'src/main.tsx'), 'utf8')
    expect(mainSrc).toContain('registerMcpXaaCommands(mcp)')
  })

  test('setup validates https/loopback http, port 1..65535, client secret env var, and stale credential cleanup', () => {
    const h = createInMemoryXaaHarness({
      MCP_XAA_IDP_CLIENT_SECRET: 'top-secret-1',
    })

    // Non-loopback http rejected
    const badHttp = runMcpXaaSetup(
      { issuer: 'http://idp.example.com', clientId: 'cid' },
      h.deps,
    )
    expect(badHttp.ok).toBe(false)
    if (!badHttp.ok) {
      expect(badHttp.error).toContain('https://')
    }

    // Invalid URL rejected
    const badUrl = runMcpXaaSetup(
      { issuer: 'not-a-url', clientId: 'cid' },
      h.deps,
    )
    expect(badUrl.ok).toBe(false)

    // Invalid callback ports rejected (0, 65536, negative, non-numeric)
    for (const badPort of ['0', '-5', '65536', 'abc', '8080px']) {
      const res = runMcpXaaSetup(
        {
          issuer: 'https://idp.example.com',
          clientId: 'cid',
          callbackPort: badPort,
        },
        h.deps,
      )
      expect(res.ok).toBe(false)
    }

    // Missing MCP_XAA_IDP_CLIENT_SECRET rejected
    const noSecretEnv = createInMemoryXaaHarness({})
    const missingSecret = runMcpXaaSetup(
      {
        issuer: 'https://idp.example.com',
        clientId: 'cid',
        clientSecret: true,
      },
      noSecretEnv.deps,
    )
    expect(missingSecret.ok).toBe(false)
    if (!missingSecret.ok) {
      expect(missingSecret.error).toContain('MCP_XAA_IDP_CLIENT_SECRET')
    }

    // Loopback http accepted (127.0.0.1, localhost, [::1])
    for (const loopbackIssuer of [
      'http://127.0.0.1:9000',
      'http://localhost:9001',
      'http://[::1]:9002',
    ]) {
      const res = runMcpXaaSetup(
        {
          issuer: loopbackIssuer,
          clientId: 'mock-client',
          callbackPort: '8123',
        },
        h.deps,
      )
      expect(res.ok).toBe(true)
    }

    // HTTPS with client secret succeeds and stores secret
    const okHttps = runMcpXaaSetup(
      {
        issuer: 'https://idp.example.com/tenant',
        clientId: 'client-a',
        clientSecret: true,
        callbackPort: '4321',
      },
      h.deps,
    )
    expect(okHttps).toEqual({
      ok: true,
      output:
        'XAA IdP connection configured for https://idp.example.com/tenant',
    })
    expect(h.getSettings()).toEqual({
      issuer: 'https://idp.example.com/tenant',
      clientId: 'client-a',
      callbackPort: 4321,
    })
    expect(h.secrets.get(issuerKey('https://idp.example.com/tenant'))).toBe(
      'top-secret-1',
    )

    // Cache a token then switch clientId -> stale token and secret cleared
    h.deps.saveIdpIdTokenFromJwt!(
      'https://idp.example.com/tenant',
      makeFakeJwt(Math.floor(Date.now() / 1000) + 3600),
    )
    const rotated = runMcpXaaSetup(
      {
        issuer: 'https://idp.example.com/tenant',
        clientId: 'client-b',
      },
      h.deps,
    )
    expect(rotated.ok).toBe(true)
    expect(h.secrets.has(issuerKey('https://idp.example.com/tenant'))).toBe(
      false,
    )
    expect(h.tokens.has(issuerKey('https://idp.example.com/tenant'))).toBe(
      false,
    )
  })

  test('login (--id-token, cached check, --force), show, and clear lifecycle', async () => {
    const h = createInMemoryXaaHarness({ MCP_XAA_IDP_CLIENT_SECRET: 'sec-xyz' })

    // Unconfigured show + login
    expect(runMcpXaaShow(h.deps)).toEqual({
      ok: true,
      output: 'No XAA IdP connection configured.',
    })
    const unconfiguredLogin = await runMcpXaaLogin({}, h.deps)
    expect(unconfiguredLogin).toEqual({
      ok: false,
      error: "Error: no XAA IdP connection. Run 'claude mcp xaa setup' first.",
    })

    // Setup without secret (PKCE-only)
    expect(
      runMcpXaaSetup(
        {
          issuer: 'https://login.example.org',
          clientId: 'claude-xaa',
          callbackPort: '9876',
        },
        h.deps,
      ).ok,
    ).toBe(true)

    const showBeforeLogin = runMcpXaaShow(h.deps)
    expect(showBeforeLogin.ok).toBe(true)
    if (showBeforeLogin.ok) {
      expect(showBeforeLogin.output).toContain(
        'Issuer:        https://login.example.org',
      )
      expect(showBeforeLogin.output).toContain('Client ID:     claude-xaa')
      expect(showBeforeLogin.output).toContain('Callback port: 9876')
      expect(showBeforeLogin.output).toContain(
        'Client secret: (not set — PKCE-only)',
      )
      expect(showBeforeLogin.output).toContain(
        "Logged in:     no — run 'claude mcp xaa login'",
      )
    }

    // login --id-token
    const jwt = makeFakeJwt(Math.floor(Date.now() / 1000) + 3600)
    const injectRes = await runMcpXaaLogin({ idToken: jwt }, h.deps)
    expect(injectRes.ok).toBe(true)
    if (injectRes.ok) {
      expect(injectRes.output).toContain(
        'id_token cached for https://login.example.org',
      )
    }

    // login without --force sees cached token
    const alreadyRes = await runMcpXaaLogin({}, h.deps)
    expect(alreadyRes.ok).toBe(true)
    if (alreadyRes.ok) {
      expect(alreadyRes.output).toContain('Already logged in')
    }
    expect(h.getAcquireCalls()).toBe(0)

    // login --force clears cache and triggers acquireIdpIdToken + prints auth URL
    const forcedRes = await runMcpXaaLogin({ force: true }, h.deps)
    expect(forcedRes.ok).toBe(true)
    expect(h.getAcquireCalls()).toBe(1)
    expect(h.stdoutLines.join('')).toContain(
      'https://login.example.org/authorize?client_id=claude-xaa',
    )

    // Re-setup with secret, check show reports keychain + logged in
    expect(
      runMcpXaaSetup(
        {
          issuer: 'https://login.example.org',
          clientId: 'claude-xaa',
          clientSecret: true,
        },
        h.deps,
      ).ok,
    ).toBe(true)
    const showAfter = runMcpXaaShow(h.deps)
    expect(showAfter.ok).toBe(true)
    if (showAfter.ok) {
      expect(showAfter.output).toContain('Client secret: (stored in keychain)')
      expect(showAfter.output).toContain('Logged in:     yes (id_token cached)')
      expect(showAfter.output).not.toContain('Callback port:')
    }

    // clear removes settings, secret, and token
    const cleared = runMcpXaaClear(h.deps)
    expect(cleared).toEqual({
      ok: true,
      output: 'XAA IdP connection cleared',
    })
    expect(h.getSettings()).toBeUndefined()
    expect(h.secrets.size).toBe(0)
    expect(h.tokens.size).toBe(0)
  })

  test('setup rejects issuer URLs with userinfo, query, or fragment; login catches invalid --id-token cleanly', async () => {
    const h = createInMemoryXaaHarness()

    for (const badIssuer of [
      'https://user:pass@idp.example',
      'https://user@idp.example',
      'https://idp.example?a=1',
      'https://idp.example#frag',
      'http://user:pass@127.0.0.1:9000',
      'http://127.0.0.1:9000?foo=bar',
      'http://127.0.0.1:9000#hash',
    ]) {
      const res = runMcpXaaSetup({ issuer: badIssuer, clientId: 'cid' }, h.deps)
      expect(res.ok).toBe(false)
    }

    expect(
      runMcpXaaSetup({ issuer: 'https://idp.example', clientId: 'cid' }, h.deps)
        .ok,
    ).toBe(true)

    // Throwing saveIdpIdTokenFromJwt is caught and returned as { ok: false, error }
    const invalidJwtRes = await runMcpXaaLogin(
      { idToken: 'not-a-valid-jwt' },
      {
        ...h.deps,
        saveIdpIdTokenFromJwt: () => {
          throw new Error('Malformed JWT')
        },
      },
    )
    expect(invalidJwtRes).toEqual({
      ok: false,
      error: "Couldn't save id_token: Malformed JWT",
    })

    // Non-finite / NaN expiry causing Date#toISOString RangeError is also caught cleanly
    const nanExpiryRes = await runMcpXaaLogin(
      { idToken: 'bad-exp.jwt.sig' },
      {
        ...h.deps,
        saveIdpIdTokenFromJwt: () => Number.NaN,
      },
    )
    expect(nanExpiryRes.ok).toBe(false)
    if (!nanExpiryRes.ok) {
      expect(nanExpiryRes.error).toContain("Couldn't save id_token:")
    }
  })

  test('R2-P1-11 & R2-P2-5: supports MCP_XAA_IDP_ID_TOKEN & --id-token-stdin, warns on --id-token, validates JWT structure/exp/iss, rejects blank clientId, clears stale secret, and allows loopback discoverOidc', async () => {
    // 1. Blank / whitespace --client-id rejected
    const h = createInMemoryXaaHarness({ MCP_XAA_IDP_CLIENT_SECRET: 'sec-1' })
    expect(
      runMcpXaaSetup({ issuer: 'https://idp.example', clientId: '   ' }, h.deps)
        .ok,
    ).toBe(false)

    // 2. Re-running setup on same issuer+clientId WITHOUT --client-secret clears stale keychain secret
    expect(
      runMcpXaaSetup(
        {
          issuer: 'https://idp.example',
          clientId: 'cid-1',
          clientSecret: true,
        },
        h.deps,
      ).ok,
    ).toBe(true)
    expect(h.secrets.get(issuerKey('https://idp.example'))).toBe('sec-1')

    expect(
      runMcpXaaSetup(
        {
          issuer: 'https://idp.example',
          clientId: 'cid-1',
          clientSecret: false,
        },
        h.deps,
      ).ok,
    ).toBe(true)
    expect(h.secrets.has(issuerKey('https://idp.example'))).toBe(false)

    // 3. MCP_XAA_IDP_ID_TOKEN env var works cleanly without stderr warning
    const validJwt = makeFakeJwt(Math.floor(Date.now() / 1000) + 3600)
    const stderrLines: string[] = []
    const envRes = await runMcpXaaLogin(
      {},
      {
        ...h.deps,
        env: { MCP_XAA_IDP_ID_TOKEN: validJwt },
        writeStderr: text => stderrLines.push(text),
      },
    )
    expect(envRes.ok).toBe(true)
    expect(stderrLines).toHaveLength(0)

    // 4. --id-token-stdin works via readIdTokenFromStdin without stderr warning
    const stdinRes = await runMcpXaaLogin(
      { idTokenStdin: true },
      {
        ...h.deps,
        readIdTokenFromStdin: async () => validJwt,
        writeStderr: text => stderrLines.push(text),
      },
    )
    expect(stdinRes.ok).toBe(true)
    expect(stderrLines).toHaveLength(0)

    // 5. Legacy --id-token emits security warning to stderr
    const legacyRes = await runMcpXaaLogin(
      { idToken: validJwt },
      {
        ...h.deps,
        writeStderr: text => stderrLines.push(text),
      },
    )
    expect(legacyRes.ok).toBe(true)
    expect(stderrLines.join('')).toContain('MCP_XAA_IDP_ID_TOKEN')

    // 6. saveIdpIdTokenFromJwt rejects malformed JWT, expired exp, and mismatched iss
    const makeJwtWithClaims = (
      claims: Record<string, unknown>,
      sig = 'sig',
    ) => {
      const hdr = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString(
        'base64url',
      )
      const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
      return `${hdr}.${body}.${sig}`
    }
    expect(() =>
      saveIdpIdTokenFromJwt('https://idp.example', 'not-a-jwt'),
    ).toThrow(/3-segment/)
    expect(() =>
      saveIdpIdTokenFromJwt('https://idp.example', 'aaa.bbb.'),
    ).toThrow(/3-segment/)
    expect(() =>
      saveIdpIdTokenFromJwt(
        'https://idp.example',
        makeJwtWithClaims({
          iss: 'https://idp.example',
          exp: Math.floor(Date.now() / 1000) - 60,
        }),
      ),
    ).toThrow(/expired/)
    expect(() =>
      saveIdpIdTokenFromJwt(
        'https://idp.example',
        makeJwtWithClaims({
          iss: 'https://evil-idp.example',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
    ).toThrow(/does not match/)

    // 7. discoverOidc allows loopback http:// token_endpoint when issuer is loopback http://
    const oidcSrv = createHttpServer((req, res) => {
      if (req.url === '/.well-known/openid-configuration') {
        const port = (oidcSrv.address() as { port: number }).port
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            issuer: `http://127.0.0.1:${port}`,
            authorization_endpoint: `http://127.0.0.1:${port}/authorize`,
            token_endpoint: `http://127.0.0.1:${port}/token`,
          }),
        )
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>(resolveListen =>
      oidcSrv.listen(0, '127.0.0.1', () => resolveListen()),
    )
    openNodeServers.push(oidcSrv)
    const oidcPort = (oidcSrv.address() as { port: number }).port
    const discovered = await discoverOidc(`http://127.0.0.1:${oidcPort}`)
    expect(discovered.token_endpoint).toBe(`http://127.0.0.1:${oidcPort}/token`)
  })
})

// ---------------------------------------------------------------------------
// 2. Official 2.1.331 Session Tunnel Early Dial (`adoptEarlyDial` / `zei`)
// ---------------------------------------------------------------------------

describe('2.1.331 Session Tunnel Early Dial (chunk #1647)', () => {
  function startBunWsRelay() {
    const receivedFrames: Array<Record<string, unknown>> = []
    let activeSocket: {
      send: (data: string) => void
      close: (code?: number, reason?: string) => void
    } | null = null
    let closedByClient = false
    let closedCode: number | undefined

    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req, srv) {
        if (srv.upgrade(req)) {
          return undefined
        }
        return new Response('upgrade required', { status: 426 })
      },
      websocket: {
        open(ws) {
          activeSocket = ws
        },
        message(_ws, msg) {
          const text =
            typeof msg === 'string' ? msg : new TextDecoder().decode(msg)
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>
            receivedFrames.push(parsed)
          } catch {
            // ignore non-json
          }
        },
        close(_ws, code) {
          closedByClient = true
          closedCode = code
        },
      },
    })
    openBunServers.push(server)

    return {
      port: server.port!,
      receivedFrames,
      getSocket: () => activeSocket,
      isClosed: () => closedByClient,
      getClosedCode: () => closedCode,
    }
  }

  test('exports official chunk #1647 constants and responds 503 tool_server_starting before adopt, then 200 tools/call after adopt via startMCPServerHttp', async () => {
    expect(TUNNEL_HOLD_MAX_FRAMES).toBe(64)
    expect(TUNNEL_HOLD_MAX_BYTES).toBe(33_554_432)
    expect(TUNNEL_HOLD_CLOSE_CODE).toBe(1013)
    expect(JSON.parse(TOOL_SERVER_STARTING_BODY)).toEqual({
      type: 'error',
      error: {
        type: 'not_forwarded',
        reason: 'tool_server_starting',
        message:
          'the tool server is still starting, so this request did not run',
      },
    })

    const relay = startBunWsRelay()
    const envelope: SessionTunnelEnvelope = {
      v: 1,
      session_id: 'sess-early-dial-1',
      session_token: 'tok-early-dial-secret',
      api_base_url: `http://127.0.0.1:${relay.port}`,
    }

    const earlyDial = startEarlySessionTunnelDial(envelope, {
      holdDeadlineMs: 5_000,
    })
    openEarlyDials.push(earlyDial)
    expect(earlyDial.state).toBe('holding')

    // Wait for tunnel_auth frame on relay
    await waitForCondition(() =>
      relay.receivedFrames.some(f => f.type === 'tunnel_auth'),
    )
    expect(relay.receivedFrames[0]).toEqual({
      type: 'tunnel_auth',
      v: 1,
      session_id: 'sess-early-dial-1',
      token: 'tok-early-dial-secret',
    })

    // Send a request while still holding BEFORE startMCPServerHttp binds/adopts
    relay.getSocket()!.send(
      JSON.stringify({
        type: 'http_request',
        id: 'req-while-starting',
        method: 'POST',
        path: '/mcp',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/list',
        }),
      }),
    )

    await waitForCondition(() =>
      relay.receivedFrames.some(
        f => f.type === 'http_response' && f.id === 'req-while-starting',
      ),
    )
    const startingReply = relay.receivedFrames.find(
      f => f.type === 'http_response' && f.id === 'req-while-starting',
    )
    expect(startingReply?.status).toBe(503)
    expect(startingReply?.body).toBe(TOOL_SERVER_STARTING_BODY)

    // Now start real MCP HTTP server and adopt the earlyDial handle!
    const dir = makeTempDir('early-dial-mcp-')
    const sampleFile = join(dir, 'greeting.txt')
    writeFileSync(sampleFile, 'hello from adopted early dial!\n', 'utf8')

    const serverHandle = await startMCPServerHttp(dir, {
      port: 0,
      announceOnStdout: false,
      earlyDial,
      getToolsOverride: () => [FileReadTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    openHttpMcpHandles.push(serverHandle)

    expect(earlyDial.state).toBe('adopted')
    expect(serverHandle.tunnelHandle).toBeDefined()
    expect(serverHandle.tunnelHandle?.state).toBe('open')

    // Send a real tools/call Read request over the adopted WebSocket tunnel
    relay.getSocket()!.send(
      JSON.stringify({
        type: 'http_request',
        id: 'req-after-adopt',
        method: 'POST',
        path: '/mcp',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: { name: 'Read', arguments: { file_path: sampleFile } },
        }),
      }),
    )

    await waitForCondition(() =>
      relay.receivedFrames.some(
        f => f.type === 'http_response' && f.id === 'req-after-adopt',
      ),
    )
    const callReply = relay.receivedFrames.find(
      f => f.type === 'http_response' && f.id === 'req-after-adopt',
    )
    expect(callReply?.status).toBe(200)
    const rpcBody = JSON.parse(String(callReply?.body)) as {
      result: { content: Array<{ text: string }> }
    }
    expect(rpcBody.result.content[0]?.text).toContain(
      'hello from adopted early dial!',
    )
  })

  test('buffers and replays frames after adopt when bufferDuringHold is true', async () => {
    const relay = startBunWsRelay()
    const envelope: SessionTunnelEnvelope = {
      v: 1,
      session_id: 'sess-buffer-1',
      session_token: 'tok-buffer',
      api_base_url: `http://127.0.0.1:${relay.port}`,
    }

    const earlyDial = startEarlySessionTunnelDial(envelope, {
      holdDeadlineMs: 5_000,
      bufferDuringHold: true,
    })
    openEarlyDials.push(earlyDial)

    await waitForCondition(() =>
      relay.receivedFrames.some(f => f.type === 'tunnel_auth'),
    )

    // Send request while holding with buffering enabled
    relay.getSocket()!.send(
      JSON.stringify({
        type: 'http_request',
        id: 'buffered-req-1',
        method: 'GET',
        path: '/health',
      }),
    )
    await new Promise(r => setTimeout(r, 40))
    // No 503 should have been emitted yet
    expect(
      relay.receivedFrames.some(
        f => f.type === 'http_response' && f.id === 'buffered-req-1',
      ),
    ).toBe(false)

    const adopted = await adoptEarlyDial(earlyDial, {
      url: 'http://127.0.0.1:28471/mcp',
      authToken: 'auth-tok',
      answer: async req => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ replayed: true, path: req.path }),
      }),
    })
    expect(adopted).toBeDefined()

    await waitForCondition(() =>
      relay.receivedFrames.some(
        f => f.type === 'http_response' && f.id === 'buffered-req-1',
      ),
    )
    const replayed = relay.receivedFrames.find(
      f => f.type === 'http_response' && f.id === 'buffered-req-1',
    )
    expect(replayed?.status).toBe(200)
    expect(JSON.parse(String(replayed?.body))).toEqual({
      replayed: true,
      path: '/health',
    })
  })

  test('closes WebSocket with code 1013 and returns undefined from adopt() when holdDeadlineMs expires before adopt', async () => {
    const relay = startBunWsRelay()
    const envelope: SessionTunnelEnvelope = {
      v: 1,
      session_id: 'sess-expire-1',
      session_token: 'tok-expire',
      api_base_url: `http://127.0.0.1:${relay.port}`,
    }

    const closeCalls: Array<{ code?: number; reason?: string }> = []
    class TrackingWebSocket extends globalThis.WebSocket {
      override close(code?: number, reason?: string): void {
        closeCalls.push({ code, reason })
        super.close(code, reason)
      }
    }

    const exitEvents: Array<{ code: number; reason: string }> = []
    const earlyDial = startEarlySessionTunnelDial(envelope, {
      holdDeadlineMs: 80,
      WebSocketImpl: TrackingWebSocket,
      onExit: (code, reason) => {
        exitEvents.push({ code, reason })
      },
    })
    openEarlyDials.push(earlyDial)

    await waitForCondition(() =>
      relay.receivedFrames.some(f => f.type === 'tunnel_auth'),
    )
    await waitForCondition(() => earlyDial.state === 'gone' && relay.isClosed())

    expect(earlyDial.state).toBe('gone')
    expect(closeCalls.some(c => c.code === TUNNEL_HOLD_CLOSE_CODE)).toBe(true)
    expect(exitEvents).toContainEqual({
      code: EX_UNAVAILABLE,
      reason: 'hold_deadline_exceeded',
    })

    const adoptResult = await earlyDial.adopt({
      url: 'http://127.0.0.1:28471/mcp',
      authToken: 'tok',
      answer: async () => ({ status: 200, headers: {}, body: '' }),
    })
    expect(adoptResult).toBeUndefined()
  })

  test('invokes onBound before awaiting earlyDial.adopt so onTunnelExit can close the server handle during adopt', async () => {
    const dir = makeTempDir('early-dial-onbound-')
    const events: string[] = []
    let boundHandle: McpHttpServerHandle | undefined

    const fakeEarlyDial: EarlySessionTunnelDialHandle = {
      state: 'holding',
      async adopt() {
        events.push(`adopt:bound=${boundHandle !== undefined}`)
        return undefined
      },
      stop() {},
    }

    const handle = await startMCPServerHttp(dir, {
      port: 0,
      announceOnStdout: false,
      earlyDial: fakeEarlyDial,
      onBound: h => {
        boundHandle = h
        events.push('onBound')
      },
      getToolsOverride: () => [FileReadTool],
      loadAgentDefinitions: async () => ({ activeAgents: [], allAgents: [] }),
    })
    openHttpMcpHandles.push(handle)

    expect(boundHandle).toBe(handle)
    expect(events).toEqual(['onBound', 'adopt:bound=true'])
  })

  test('does not leak timers when WebSocket constructor throws synchronously', () => {
    const envelope: SessionTunnelEnvelope = {
      v: 1,
      session_id: 'sess-sync-throw',
      session_token: 'tok-throw',
      api_base_url: 'http://127.0.0.1:1',
    }
    class ThrowingWebSocket {
      constructor() {
        throw new Error('ws ctor boom')
      }
    }
    expect(() =>
      startEarlySessionTunnelDial(envelope, {
        holdDeadlineMs: 10,
        livenessDeadlineMs: 10,
        WebSocketImpl:
          ThrowingWebSocket as unknown as typeof globalThis.WebSocket,
      }),
    ).toThrow('ws ctor boom')
  })
})

// ---------------------------------------------------------------------------
// 3. Pluggable StorageV5 HTTP Hover REST Backend + env auto-wiring
// ---------------------------------------------------------------------------

describe('StorageV5 HTTP Hover REST Backend', () => {
  async function readJsonBody(
    req: IncomingMessage,
  ): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  }

  function writeJson(
    res: ServerResponse,
    status: number,
    payload: unknown,
  ): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  function mapV5ErrorToHttpStatus(code: string): number {
    switch (code) {
      case 'NotFound':
        return 404
      case 'PreconditionFailed':
        return 412
      case 'InvalidArgument':
        return 400
      case 'PermissionDenied':
        return 403
      case 'AlreadyHeld':
        return 409
      case 'TooLarge':
        return 413
      default:
        return 500
    }
  }

  async function startMockHoverRestServer(expectedToken: string) {
    const mem = createMemoryStorageV5Backend()
    const activeLeases = new Map<
      string,
      {
        handle: Awaited<ReturnType<typeof mem.acquireLease>>
        holder: string
      }
    >()
    let forceStatus500 = false

    const server = createHttpServer((req, res) => {
      void (async () => {
        if (forceStatus500) {
          writeJson(res, 500, { error: { code: 'InternalError' } })
          return
        }

        const auth = req.headers.authorization
        if (auth !== `Bearer ${expectedToken}`) {
          writeJson(res, 401, { error: { code: 'Unauthorized' } })
          return
        }

        const body = await readJsonBody(req)
        const path = req.url ?? '/'

        if (path === '/v5/keys/write') {
          const val =
            body.encoding === 'base64' && typeof body.value === 'string'
              ? new Uint8Array(Buffer.from(body.value, 'base64'))
              : String(body.value ?? '')
          const result = await mem.write(
            body.key,
            val,
            body.opts as Parameters<typeof mem.write>[2],
          )
          if (!result.ok) {
            writeJson(res, mapV5ErrorToHttpStatus(result.error.code), result)
            return
          }
          writeJson(res, 200, result.value)
          return
        }

        if (path === '/v5/keys/read') {
          const result = await mem.read(
            body.reqs as Parameters<typeof mem.read>[0],
            body.opts as Parameters<typeof mem.read>[1],
          )
          if (!result.ok) {
            writeJson(res, mapV5ErrorToHttpStatus(result.error.code), result)
            return
          }
          writeJson(res, 200, {
            items: result.value.items.map(item =>
              item.found && item.value !== undefined
                ? {
                    found: true,
                    totalBytes: item.totalBytes,
                    valueBase64: Buffer.from(item.value).toString('base64'),
                    version: item.version,
                    mtimeMs: item.mtimeMs,
                  }
                : { found: false, totalBytes: 0 },
            ),
          })
          return
        }

        if (path === '/v5/keys/stat') {
          const result = await mem.stat(body.key)
          if (!result.ok) {
            writeJson(res, mapV5ErrorToHttpStatus(result.error.code), result)
            return
          }
          writeJson(res, 200, result.value)
          return
        }

        if (path === '/v5/keys/delete') {
          const result = await mem.delete(body.key)
          if (!result.ok) {
            writeJson(res, mapV5ErrorToHttpStatus(result.error.code), result)
            return
          }
          writeJson(res, 200, result.value)
          return
        }

        if (path === '/v5/scopes/list-entries') {
          const result = await mem.listEntries(
            body.scope,
            body.opts as Parameters<typeof mem.listEntries>[1],
          )
          if (!result.ok) {
            writeJson(res, mapV5ErrorToHttpStatus(result.error.code), result)
            return
          }
          writeJson(res, 200, result.value)
          return
        }

        if (path === '/v5/streams/append') {
          const rawRecords = Array.isArray(body.records) ? body.records : []
          const decoded = rawRecords.map(rec => {
            const r = rec as {
              data: string
              encoding?: string
              recordId?: string
            }
            return {
              data:
                r.encoding === 'base64'
                  ? new Uint8Array(Buffer.from(r.data, 'base64'))
                  : r.data,
              ...(r.recordId !== undefined ? { recordId: r.recordId } : {}),
            }
          })
          const result = await mem.append(
            body.key,
            decoded,
            body.opts as Parameters<typeof mem.append>[2],
          )
          if (!result.ok) {
            writeJson(res, mapV5ErrorToHttpStatus(result.error.code), result)
            return
          }
          writeJson(res, 200, result.value)
          return
        }

        if (path === '/v5/streams/read-records') {
          const result = await mem.readRecords(
            body.key,
            body.opts as Parameters<typeof mem.readRecords>[1],
          )
          if (!result.ok) {
            writeJson(res, mapV5ErrorToHttpStatus(result.error.code), result)
            return
          }
          writeJson(res, 200, {
            items: result.value.items.map(item => ({
              ...item,
              dataBase64: Buffer.from(item.data).toString('base64'),
              data: undefined,
            })),
            nextSeq: result.value.nextSeq,
          })
          return
        }

        if (path === '/v5/leases/acquire') {
          const result = await mem.acquireLease(
            body.target,
            Number(body.ttlMs),
            body.opts as Parameters<typeof mem.acquireLease>[2],
          )
          if (!result.ok) {
            writeJson(res, mapV5ErrorToHttpStatus(result.error.code), result)
            return
          }
          const leaseId = `lease-${activeLeases.size + 1}`
          activeLeases.set(leaseId, {
            handle: result,
            holder: result.value.holder,
          })
          writeJson(res, 200, {
            leaseId,
            holder: result.value.holder,
            expiresAtMs: result.value.expiresAtMs,
          })
          return
        }

        if (path === '/v5/leases/renew') {
          const entry = activeLeases.get(String(body.leaseId ?? ''))
          if (!entry || !entry.handle.ok) {
            writeJson(res, 404, { error: { code: 'NotFound' } })
            return
          }
          const renewRes = await entry.handle.value.renew(Number(body.ttlMs))
          if (!renewRes.ok) {
            writeJson(
              res,
              mapV5ErrorToHttpStatus(renewRes.error.code),
              renewRes,
            )
            return
          }
          writeJson(res, 200, renewRes.value)
          return
        }

        if (path === '/v5/leases/release') {
          const leaseId = String(body.leaseId ?? '')
          const entry = activeLeases.get(leaseId)
          if (!entry || !entry.handle.ok) {
            writeJson(res, 404, { error: { code: 'NotFound' } })
            return
          }
          const relRes = await entry.handle.value.release()
          activeLeases.delete(leaseId)
          if (!relRes.ok) {
            writeJson(res, mapV5ErrorToHttpStatus(relRes.error.code), relRes)
            return
          }
          writeJson(res, 200, { released: true })
          return
        }

        writeJson(res, 404, { error: { code: 'NotFound' } })
      })().catch(() => {
        writeJson(res, 500, { error: { code: 'InternalError' } })
      })
    })

    await new Promise<void>(resolveListen =>
      server.listen(0, '127.0.0.1', () => resolveListen()),
    )
    openNodeServers.push(server)
    const addr = server.address()
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind mock Hover REST server')
    }

    return {
      baseUrl: `http://127.0.0.1:${addr.port}`,
      setForceStatus500: (flag: boolean) => {
        forceStatus500 = flag
      },
    }
  }

  test('validates baseUrl (accepts https and loopback http; rejects non-loopback http and bad schemes)', () => {
    expect(() =>
      createHoverRestBackend({ baseUrl: 'https://storage.example.com/api' }),
    ).not.toThrow()
    expect(() =>
      createHoverRestBackend({ baseUrl: 'http://127.0.0.1:8080' }),
    ).not.toThrow()
    expect(() =>
      createHoverRestBackend({ baseUrl: 'http://localhost:8080' }),
    ).not.toThrow()
    expect(() =>
      createHoverRestBackend({ baseUrl: 'http://[::1]:8080' }),
    ).not.toThrow()

    expect(() =>
      createHoverRestBackend({ baseUrl: 'http://storage.example.com' }),
    ).toThrow(/https:\/\/ or loopback http:\/\//)
    expect(() =>
      createHoverRestBackend({ baseUrl: 'ftp://127.0.0.1:21' }),
    ).toThrow(/https:\/\/ or loopback http:\/\//)
    expect(() => createHoverRestBackend({ baseUrl: 'not-a-url' })).toThrow()
  })

  test('supports write (ifAbsent/ifMatch/none), read, stat, delete, listEntries, append/readRecords, leases, and HTTP error mapping against live node:http server', async () => {
    const srv = await startMockHoverRestServer('hover-secret-token')
    const v5 = createHoverRestBackend({
      baseUrl: srv.baseUrl,
      authToken: async () => 'hover-secret-token',
    })

    const key = { namespace: 'job', jobId: 'job-1', relPath: ['one.json'] }
    const key2 = { namespace: 'job', jobId: 'job-1', relPath: ['two.bin'] }

    // 1. stat on missing key -> 404 -> NotFound
    const missingStat = await v5.stat(key)
    expect(missingStat.ok).toBe(false)
    if (!missingStat.ok) {
      expect(missingStat.error.code).toBe('NotFound')
    }

    // 2. write with ifAbsent succeeds first time, fails with 412 -> PreconditionFailed second time
    const w1 = await v5.write(key, '{"count":1}', {
      precondition: { type: 'ifAbsent' },
    })
    expect(w1.ok).toBe(true)
    if (!w1.ok) throw new Error('expected w1 ok')

    const w1Dup = await v5.write(key, '{"count":2}', {
      precondition: { type: 'ifAbsent' },
    })
    expect(w1Dup.ok).toBe(false)
    if (!w1Dup.ok) {
      expect(w1Dup.error.code).toBe('PreconditionFailed')
    }

    // 3. write with ifMatch (stale version -> 412, matching version -> 200)
    const wStale = await v5.write(key, '{"count":3}', {
      precondition: { type: 'ifMatch', version: 'wrong-version' },
    })
    expect(wStale.ok).toBe(false)
    if (!wStale.ok) {
      expect(wStale.error.code).toBe('PreconditionFailed')
    }

    const w2 = await v5.write(key, '{"count":3}', {
      precondition: { type: 'ifMatch', version: w1.value.version },
    })
    expect(w2.ok).toBe(true)

    // 4. write with precondition 'none' + binary Uint8Array
    const binaryPayload = new Uint8Array([0, 1, 2, 255, 65, 66])
    const wBin = await v5.write(key2, binaryPayload, {
      precondition: { type: 'none' },
    })
    expect(wBin.ok).toBe(true)

    // 5. read + readText + stat
    const readRes = await v5.read([key, key2])
    expect(readRes.ok).toBe(true)
    if (readRes.ok) {
      expect(readRes.value.items[0]?.found).toBe(true)
      expect(new TextDecoder().decode(readRes.value.items[0]?.value)).toBe(
        '{"count":3}',
      )
      expect(readRes.value.items[1]?.found).toBe(true)
      expect(Array.from(readRes.value.items[1]?.value ?? [])).toEqual([
        0, 1, 2, 255, 65, 66,
      ])
    }

    const readTextRes = await v5.readText([key])
    expect(readTextRes.ok).toBe(true)
    if (readTextRes.ok) {
      expect(readTextRes.value.items[0]?.value).toBe('{"count":3}')
    }

    const statRes = await v5.stat(key)
    expect(statRes.ok).toBe(true)
    if (statRes.ok) {
      expect(statRes.value.size).toBe(11)
      expect(typeof statRes.value.mtimeMs).toBe('number')
    }

    // 6. listEntries
    const listRes = await v5.listEntries({ namespace: 'job', jobId: 'job-1' })
    expect(listRes.ok).toBe(true)
    if (listRes.ok) {
      expect(listRes.value.items.length).toBeGreaterThanOrEqual(2)
    }

    // 7. delete
    const del1 = await v5.delete(key)
    expect(del1).toEqual({ ok: true, value: { existed: true } })
    const del2 = await v5.delete(key)
    expect(del2).toEqual({ ok: true, value: { existed: false } })

    // 8. append & readRecords
    const streamKey = { namespace: 'history' }
    const appRes = await v5.append(streamKey, [
      { data: '{"event":"a"}', recordId: 'r1' },
      { data: new TextEncoder().encode('{"event":"b"}'), recordId: 'r2' },
    ])
    expect(appRes.ok).toBe(true)
    if (appRes.ok) {
      expect(appRes.value.acks.map(a => a.recordId)).toEqual(['r1', 'r2'])
    }

    const recRes = await v5.readRecords(streamKey, {
      order: 'forward',
      limit: 10,
    })
    expect(recRes.ok).toBe(true)
    if (recRes.ok) {
      expect(recRes.value.items.length).toBe(2)
      expect(new TextDecoder().decode(recRes.value.items[0]?.data)).toBe(
        '{"event":"a"}',
      )
      expect(new TextDecoder().decode(recRes.value.items[1]?.data)).toBe(
        '{"event":"b"}',
      )
    }

    // 9. acquireLease / renew / contention / release
    const leaseTarget = { namespace: 'daemon', name: 'lock-1' }
    const leaseRes = await v5.acquireLease(leaseTarget, 5_000, {
      holder: 'worker-1',
    })
    expect(leaseRes.ok).toBe(true)
    if (!leaseRes.ok) throw new Error('expected lease acquired')
    const initialExpiry = leaseRes.value.expiresAtMs

    // Contending holder gets AlreadyHeld (409)
    const contendRes = await v5.acquireLease(leaseTarget, 5_000, {
      holder: 'worker-2',
    })
    expect(contendRes.ok).toBe(false)
    if (!contendRes.ok) {
      expect(contendRes.error.code).toBe('AlreadyHeld')
    }

    // Renew extends expiry
    const renewRes = await leaseRes.value.renew(60_000)
    expect(renewRes.ok).toBe(true)
    if (renewRes.ok) {
      expect(renewRes.value.expiresAtMs).toBeGreaterThan(initialExpiry)
      expect(leaseRes.value.expiresAtMs).toBe(renewRes.value.expiresAtMs)
    }

    // Release frees the lease for worker-2
    const releaseRes = await leaseRes.value.release()
    expect(releaseRes.ok).toBe(true)

    const leaseAfterRelease = await v5.acquireLease(leaseTarget, 5_000, {
      holder: 'worker-2',
    })
    expect(leaseAfterRelease.ok).toBe(true)

    // 10. Error mapping: 401 -> PermissionDenied, 500 -> Unavailable
    const badAuthV5 = createHoverRestBackend({
      baseUrl: srv.baseUrl,
      authToken: 'wrong-token',
    })
    const unauthRes = await badAuthV5.stat(key2)
    expect(unauthRes.ok).toBe(false)
    if (!unauthRes.ok) {
      expect(unauthRes.error.code).toBe('PermissionDenied')
    }

    srv.setForceStatus500(true)
    const err500 = await v5.stat(key2)
    expect(err500.ok).toBe(false)
    if (!err500.ok) {
      expect(err500.error.code).toBe('Unavailable')
    }
    srv.setForceStatus500(false)
  })

  test('tryCreateV5Backend() auto-wires CLAUDE_CODE_HOVER_REST_URL + CLAUDE_CODE_HOVER_REST_TOKEN when hover-rest is pinned on', async () => {
    const srv = await startMockHoverRestServer('env-auto-token')
    process.env.CLAUDE_CODE_HOVER_REST_URL = srv.baseUrl
    process.env.CLAUDE_CODE_HOVER_REST_TOKEN = 'env-auto-token'

    // Before pinning hover-rest on -> undefined
    expect(tryCreateV5Backend()).toBeUndefined()

    // After pinning hover-rest on -> live Hover REST backend!
    recordHoverRestDecision(true)
    const backend = tryCreateV5Backend()
    expect(backend).toBeDefined()

    const key = { namespace: 'state', id: 'stats-cache' }
    const w = await backend!.write(key, 'auto-wired-value')
    expect(w.ok).toBe(true)
    const r = await backend!.readText([key])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.items[0]?.value).toBe('auto-wired-value')
    }
  })

  test('passes redirect: "error" and deduplicates case-variant Authorization and Content-Type headers', async () => {
    const capturedInits: Array<RequestInit | undefined> = []
    const backend = createHoverRestBackend({
      baseUrl: 'https://storage.example.com',
      authToken: 'real-bearer-token',
      headers: {
        Authorization: 'Bearer stale-uppercase',
        AUTHORIZATION: 'Bearer stale-allcaps',
        'Content-Type': 'text/plain',
        'X-Custom-Header': 'custom-val',
      },
      fetchImpl: async (_input, init) => {
        capturedInits.push(init)
        return new Response(JSON.stringify({ size: 42, mtimeMs: 1234 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    const res = await backend.stat({ namespace: 'state', id: 'test' })
    expect(res.ok).toBe(true)
    expect(capturedInits.length).toBe(1)

    const init = capturedInits[0]!
    expect(init.redirect).toBe('error')

    const headers = init.headers as Record<string, string>
    const authKeys = Object.keys(headers).filter(
      k => k.toLowerCase() === 'authorization',
    )
    const ctKeys = Object.keys(headers).filter(
      k => k.toLowerCase() === 'content-type',
    )
    expect(authKeys).toEqual(['authorization'])
    expect(headers.authorization).toBe('Bearer real-bearer-token')
    expect(ctKeys).toEqual(['content-type'])
    expect(headers['content-type']).toBe('application/json')
    expect(headers['x-custom-header']).toBe('custom-val')
  })
})
