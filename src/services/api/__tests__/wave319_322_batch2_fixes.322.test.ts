import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import * as net from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import * as tls from 'tls'
import { APIConnectionError, APIError } from '@anthropic-ai/sdk'
import {
  checkUnchangedImageRereadLimit as toolCheckLimit,
  noteImageMediaStripped as toolNoteStripped,
  resetImageRereadState as toolResetState,
  UNCHANGED_IMAGE_REREAD_LIMIT as TOOL_REREAD_LIMIT,
  UnchangedImageRereadLimitError as ToolRereadError,
} from '../../../../packages/builtin-tools/src/tools/FileReadTool/FileReadTool.js'
import {
  completeAgentTask,
  failAgentTask,
  type LocalAgentTaskState,
} from '../../../tasks/LocalAgentTask/LocalAgentTask.js'
import {
  clearOAuthTokenCache,
  handleOAuth401Error,
} from '../../../utils/auth.js'
import { setSdkOauthTokenRefreshCallback } from '../../../utils/sdkOauthTokenRefresh.js'
import {
  readApiServedCertificateChain,
  readPeerChainViaTlsHandshake,
} from '../../../utils/mtls.js'
import {
  checkUnchangedImageRereadLimit,
  noteImageMediaStripped,
  resetImageRereadState,
  shouldTrackImageMediaStripped,
  UNCHANGED_IMAGE_REREAD_LIMIT,
  UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE,
  UnchangedImageRereadLimitError,
} from '../../../utils/subagentCacheEvict.js'
import {
  StreamTruncatedError,
  wrapMidStreamTlsErrorAsTruncated,
} from '../claude.js'
import {
  formatGatewayErrorMessage,
  getAssistantMessageFromError,
  sanitizeGatewayErrorText,
} from '../errors.js'
import { isStaleConnectionError, shouldRetry, withRetry } from '../withRetry.js'

const savedEnv = { ...process.env }
const tempDirs: string[] = []

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key]
    }
  }
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v !== undefined) {
      process.env[k] = v
    }
  }
}

function generateSelfSignedCert(): { cert: string; key: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mtls-proxy-cert-'))
  tempDirs.push(dir)
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=127.0.0.1',
    ],
    { stdio: 'ignore' },
  )
  return {
    key: readFileSync(keyPath, 'utf8'),
    cert: readFileSync(certPath, 'utf8'),
  }
}

afterEach(() => {
  restoreEnv()
  resetImageRereadState()
  clearOAuthTokenCache()
  setSdkOauthTokenRefreshCallback(null)
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

describe('Wave 319-322 Batch 2 Fixes', () => {
  test('#1878: StreamTruncatedError extends APIConnectionError, preserves code, and is retried by withRetry', async () => {
    const rawSslErr = Object.assign(
      new Error('EPROTO: The TLS handshake failed'),
      { code: 'EPROTO' },
    )
    const wrapped = wrapMidStreamTlsErrorAsTruncated(rawSslErr, true)
    expect(wrapped).toBeInstanceOf(StreamTruncatedError)
    expect(wrapped).toBeInstanceOf(APIConnectionError)
    expect(wrapped).toBeInstanceOf(APIError)
    expect((wrapped as StreamTruncatedError).code).toBe('StreamTruncated')
    expect(isStaleConnectionError(wrapped)).toBe(true)
    expect(shouldRetry(wrapped as APIError)).toBe(true)

    let attempts = 0
    const gen = withRetry(
      async () => ({}) as never,
      async () => {
        attempts++
        if (attempts === 1) {
          throw wrapped
        }
        return 'recovered-on-retry'
      },
      {
        maxRetries: 2,
        model: 'claude-sonnet-4-6',
        thinkingConfig: { type: 'disabled' },
      },
    )
    let step = await gen.next()
    while (!step.done) {
      step = await gen.next()
    }
    expect(attempts).toBe(2)
    expect(step.value).toBe('recovered-on-retry')
  })

  test('#1722: pending401Handlers deduplicates concurrent 401s and invokes onForcedRefreshOutcome for all waiters', async () => {
    // Use adoptOnly=false with two concurrent callers on the same failed token
    // when no keychain refresh token is present: verify dedup promise sharing and
    // callback delivery when forced refresh executes.
    const outcomesA: string[] = []
    const outcomesB: string[] = []
    let sdkCalls = 0
    let releaseSdk!: () => void
    const sdkGate = new Promise<void>(resolve => {
      releaseSdk = resolve
    })
    setSdkOauthTokenRefreshCallback(async () => {
      sdkCalls++
      await sdkGate
      return 'fresh-token-from-sdk'
    })

    const p1 = handleOAuth401Error('expired-token-1722', {
      onForcedRefreshOutcome: o => outcomesA.push(o),
    })
    const p2 = handleOAuth401Error('expired-token-1722', {
      onForcedRefreshOutcome: o => outcomesB.push(o),
    })
    // Same deduped promise is returned to both concurrent callers
    expect(p1).toBe(p2)
    releaseSdk()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    expect(sdkCalls).toBe(1)

    // Verify withRetry source sets oauth401ForcedRefreshDone on both 'refreshed' and 'failed'
    const withRetrySrc = readFileSync(
      join(process.cwd(), 'src/services/api/withRetry.ts'),
      'utf8',
    )
    expect(withRetrySrc).toContain(
      "if (forcedOutcome === 'refreshed' || forcedOutcome === 'failed')",
    )
  })

  test('#1784/#1817: readApiServedCertificateChain forwards proxyUrl and readPeerChainViaTlsHandshake tunnels via HTTP CONNECT with Basic auth', async () => {
    // 1) readApiServedCertificateChain passes parsed proxyUrl to handshakeFn
    let capturedProxyUrl: URL | undefined
    const outcome = await readApiServedCertificateChain(
      'https://api.anthropic.com',
      {
        afterModelRequest: true,
        env: {
          HTTPS_PROXY: 'http://alice:s3cr3t@127.0.0.1:8888',
        },
        handshakeFn: async (_host, _port, _signal, proxyUrl) => {
          capturedProxyUrl = proxyUrl
          return []
        },
      },
    )
    expect(outcome).toBe('nothing')
    expect(capturedProxyUrl?.href).toBe('http://alice:s3cr3t@127.0.0.1:8888/')

    // 2) End-to-end TLS handshake over a local HTTP CONNECT proxy with Basic auth
    const { cert, key } = generateSelfSignedCert()
    const tlsServer = tls.createServer({ cert, key }, socket => {
      socket.on('error', () => {})
    })
    await new Promise<void>(resolve =>
      tlsServer.listen(0, '127.0.0.1', resolve),
    )
    const tlsPort = (tlsServer.address() as net.AddressInfo).port

    let seenConnectLine = ''
    let seenProxyAuth = ''
    const proxyServer = net.createServer(clientSock => {
      let headerBuf = Buffer.alloc(0)
      const onData = (chunk: Buffer) => {
        headerBuf = Buffer.concat([headerBuf, chunk])
        const idx = headerBuf.indexOf('\r\n\r\n')
        if (idx === -1) return
        clientSock.off('data', onData)
        const lines = headerBuf
          .subarray(0, idx)
          .toString('latin1')
          .split('\r\n')
        seenConnectLine = lines[0] ?? ''
        seenProxyAuth =
          lines.find(l => l.toLowerCase().startsWith('proxy-authorization:')) ??
          ''
        const upstream = net.connect(
          { host: '127.0.0.1', port: tlsPort },
          () => {
            clientSock.write('HTTP/1.1 200 Connection Established\r\n\r\n')
            const remainder = headerBuf.subarray(idx + 4)
            if (remainder.length > 0) upstream.write(remainder)
            clientSock.pipe(upstream)
            upstream.pipe(clientSock)
          },
        )
        upstream.on('error', () => clientSock.destroy())
        clientSock.on('error', () => upstream.destroy())
      }
      clientSock.on('data', onData)
      clientSock.on('error', () => {})
    })
    await new Promise<void>(resolve =>
      proxyServer.listen(0, '127.0.0.1', resolve),
    )
    const proxyPort = (proxyServer.address() as net.AddressInfo).port

    try {
      const certs = await readPeerChainViaTlsHandshake(
        '127.0.0.1',
        tlsPort,
        AbortSignal.timeout(5000),
        new URL(`http://bob:p%40ss@127.0.0.1:${proxyPort}`),
      )
      expect(seenConnectLine).toBe(`CONNECT 127.0.0.1:${tlsPort} HTTP/1.1`)
      const expectedAuth = `Basic ${Buffer.from('bob:p@ss', 'utf8').toString('base64')}`
      expect(seenProxyAuth.toLowerCase()).toBe(
        `proxy-authorization: ${expectedAuth}`.toLowerCase(),
      )
      expect(certs).not.toBeNull()
      expect(certs!.length).toBeGreaterThanOrEqual(1)
      expect(certs![0]!.subject).toContain('CN=127.0.0.1')
    } finally {
      proxyServer.close()
      tlsServer.close()
    }
  })

  test('#1929: leaf module extraction, FileReadTool re-export parity, shouldTrackImageMediaStripped, and LocalAgentTask cleanup', () => {
    // Re-export identity parity
    expect(toolNoteStripped).toBe(noteImageMediaStripped)
    expect(toolCheckLimit).toBe(checkUnchangedImageRereadLimit)
    expect(toolResetState).toBe(resetImageRereadState)
    expect(TOOL_REREAD_LIMIT).toBe(UNCHANGED_IMAGE_REREAD_LIMIT)
    expect(ToolRereadError).toBe(UnchangedImageRereadLimitError)

    // No static cycle: claude.ts must not import FileReadTool
    const claudeSrc = readFileSync(
      join(process.cwd(), 'src/services/api/claude.ts'),
      'utf8',
    )
    expect(claudeSrc).not.toContain('tools/FileReadTool/FileReadTool')

    // shouldTrackImageMediaStripped covers repl_main_thread* and excludes undefined querySource
    expect(shouldTrackImageMediaStripped(undefined, undefined)).toBe(false)
    expect(shouldTrackImageMediaStripped('compact', undefined)).toBe(false)
    expect(shouldTrackImageMediaStripped('repl_main_thread', undefined)).toBe(
      true,
    )
    expect(
      shouldTrackImageMediaStripped(
        'repl_main_thread:outputStyle:concise',
        undefined,
      ),
    ).toBe(true)
    expect(shouldTrackImageMediaStripped('sdk', undefined)).toBe(true)
    expect(shouldTrackImageMediaStripped('agent:explore', 'ag-1')).toBe(true)
    expect(shouldTrackImageMediaStripped('agent:explore', undefined)).toBe(
      false,
    )

    // LocalAgentTask terminal transitions (completeAgentTask & failAgentTask) evict image reread state
    const makeTrippedAgent = (agentId: string) => {
      noteImageMediaStripped(agentId, 1)
      for (let i = 0; i < 48; i++) {
        checkUnchangedImageRereadLimit(agentId, `/tmp/x-${i}.png`, 'same')
      }
      for (let i = 0; i < 3; i++) {
        checkUnchangedImageRereadLimit(agentId, '/tmp/target.png', 'img')
      }
      expect(
        checkUnchangedImageRereadLimit(agentId, '/tmp/target.png', 'img'),
      ).toBe(UNCHANGED_IMAGE_REREAD_LIMIT_MESSAGE)
    }

    const makeMockRegistry = (taskId: string) => {
      let task: LocalAgentTaskState = {
        id: taskId,
        type: 'local_agent',
        status: 'running',
        description: 'test agent',
        startTime: Date.now(),
        outputFile: '',
        outputOffset: 0,
        notified: false,
        agentId: taskId,
        prompt: 'hi',
        selectedAgent: undefined,
        agentType: 'general',
        model: undefined,
        abortController: new AbortController(),
        messages: [],
        progress: { toolUseCount: 0, tokenCount: 0 },
        retain: false,
        diskLoaded: false,
        isBackgrounded: true,
      } as unknown as LocalAgentTaskState
      return {
        get: (id: string) => (id === taskId ? task : undefined),
        list: () => [task],
        update: <T>(id: string, fn: (t: T) => T) => {
          if (id === taskId) {
            task = fn(task as unknown as T) as unknown as LocalAgentTaskState
          }
        },
        getAppState: () => ({ tasks: { [taskId]: task } }),
      } as never
    }

    makeTrippedAgent('subagent-complete-1929')
    completeAgentTask(
      {
        agentId: 'subagent-complete-1929',
        content: [],
        totalDurationMs: 10,
        totalTokens: 1,
        totalToolUseCount: 0,
        usage: {} as never,
      } as never,
      makeMockRegistry('subagent-complete-1929'),
      { skipJeo: true },
    )
    expect(
      checkUnchangedImageRereadLimit(
        'subagent-complete-1929',
        '/tmp/target.png',
        'img',
      ),
    ).toBeUndefined()

    makeTrippedAgent('subagent-fail-1929')
    failAgentTask(
      'subagent-fail-1929',
      'boom',
      makeMockRegistry('subagent-fail-1929'),
    )
    expect(
      checkUnchangedImageRereadLimit(
        'subagent-fail-1929',
        '/tmp/target.png',
        'img',
      ),
    ).toBeUndefined()
  })

  test('#1932: errors.ts strips embedded username:password from gateway/proxy URLs', () => {
    expect(
      sanitizeGatewayErrorText(
        'Proxy failed at https://alice:s3cr3t@proxy.corp.net:8443/v1?tok=1.',
      ),
    ).toBe('Proxy failed at https://proxy.corp.net:8443/v1.')

    expect(
      formatGatewayErrorMessage(
        'https://u1:pw1@gw.corp.net/api',
        'upstream rejected https://u2:pw2@backend.corp.net/v1',
      ),
    ).toBe(
      'Gateway error (https://gw.corp.net/api): upstream rejected https://backend.corp.net/v1',
    )

    const connErr = new APIConnectionError({
      message:
        'Failed connecting to https://alice:s3cr3t@gw.corp.net/v1/messages',
    })
    const connMsg = getAssistantMessageFromError(connErr, 'claude-sonnet-4-6')
    const connText = String(
      (connMsg.message.content?.[0] as { text?: string } | undefined)?.text ??
        '',
    )
    expect(connText).not.toContain('alice:s3cr3t')
    expect(connText).toContain('https://gw.corp.net/v1/messages')

    const authErr = new APIError(
      401,
      {
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'Unauthorized at https://bob:topsecret@gw.corp.net/v1',
        },
      },
      'Unauthorized at https://bob:topsecret@gw.corp.net/v1',
      new Headers(),
    )
    const authMsg = getAssistantMessageFromError(authErr, 'claude-sonnet-4-6')
    const authText = String(
      (authMsg.message.content?.[0] as { text?: string } | undefined)?.text ??
        '',
    )
    expect(authText).not.toContain('bob:topsecret')
    expect(authText).toContain('https://gw.corp.net/v1')

    const gwErr = Object.assign(new Error('gateway refused request'), {
      gatewayUrl: 'https://svc:pass@gw.corp.net/v1',
    })
    const gwMsg = getAssistantMessageFromError(gwErr, 'claude-sonnet-4-6')
    const gwText = String(
      (gwMsg.message.content?.[0] as { text?: string } | undefined)?.text ?? '',
    )
    expect(gwText).not.toContain('svc:pass')
    expect(gwText).toContain('Gateway error (https://gw.corp.net/v1):')
  })
})
