/**
 * densable 2.1.238 #5 F4y graph — P4y/VtC/ZtC/erC/trC/H4y/$4y.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, connect as netConnect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/utils/errors.js'
import { configureGlobalAgents } from 'src/utils/proxy.js'
import {
  LOOPBACK_REALM,
  PROXY_AUTH_COMMAND_ENV,
  PROXY_AUTH_FILE_ENV,
  PROXY_AUTH_VALUE_MAX_BYTES,
  ProxyAuthorizationMintError,
  _resetEgressProxyAuthForTesting,
  assertOrchestratorProxyAuthUnset,
  commandEnvWithOriginalProxy,
  createProxyAuthorizationMinter,
  enableEgressProxyAuth,
  parseProxyAuthorizationValue,
  redactEgressProxyText,
  rewriteProcessProxyEnv,
  sessionChildProxyEnvOverlay,
  startEgressProxyListener,
} from '../egressProxyAuth.js'

const PROXY_KEYS = [
  'https_proxy',
  'HTTPS_PROXY',
  'http_proxy',
  'HTTP_PROXY',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
  'CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER',
  PROXY_AUTH_COMMAND_ENV,
  PROXY_AUTH_FILE_ENV,
] as const

const savedEnv: Record<string, string | undefined> = {}

function setEnv(k: string, v: string | undefined): void {
  if (!(k in savedEnv)) savedEnv[k] = process.env[k]
  if (v === undefined) delete process.env[k]
  else process.env[k] = v
}

afterEach(() => {
  _resetEgressProxyAuthForTesting()
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete savedEnv[k]
  }
  for (const k of PROXY_KEYS) delete process.env[k]
  // F4y calls Sre/configureGlobalAgents after erC. Close does not restore
  // process.env; re-run agents against the wiped keys so later files in the
  // same bun process are not left on a dead loopback interceptor.
  configureGlobalAgents()
})

function loopbackAuthHeader(listenerUrl: string): string {
  const u = new URL(listenerUrl)
  return 'Basic ' + Buffer.from(`runner:${u.password}`).toString('base64')
}

function readUntilHead(sock: Socket, ms = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for head: ${buf.toString('latin1')}`))
    }, ms)
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (buf.includes('\r\n\r\n')) {
        clearTimeout(timer)
        sock.removeListener('data', onData)
        resolve(buf.toString('latin1'))
      }
    }
    sock.on('data', onData)
    sock.once('error', err => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function startFakeUpstream(
  onHead: (head: string, sock: Socket) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer(sock => {
      let buf = Buffer.alloc(0)
      sock.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk])
        const idx = buf.indexOf('\r\n\r\n')
        if (idx >= 0) onHead(buf.subarray(0, idx).toString('latin1'), sock)
      })
    })
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.removeListener('error', reject)
      const addr = server.address()
      resolve({
        port: addr && typeof addr === 'object' ? addr.port : 0,
        close: () =>
          new Promise(r => {
            server.close(() => r())
          }),
      })
    })
  })
}

async function requestListener(port: number, request: string): Promise<string> {
  const sock = netConnect({ host: '127.0.0.1', port })
  const pending = readUntilHead(sock)
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', () => resolve())
    sock.once('error', reject)
  })
  sock.write(request)
  try {
    return await pending
  } finally {
    sock.destroy()
  }
}

describe('densable 2.1.238 #5 P4y parseProxyAuthorizationValue', () => {
  test('trims a single header line', () => {
    expect(parseProxyAuthorizationValue('  Bearer tok  ')).toBe('Bearer tok')
  })

  test('rejects empty / control chars / oversized', () => {
    expect(() => parseProxyAuthorizationValue('   ')).toThrow(
      ProxyAuthorizationMintError,
    )
    expect(() => parseProxyAuthorizationValue('Bearer\r\nx')).toThrow(
      /control characters/,
    )
    expect(() => parseProxyAuthorizationValue('Bearer\n x')).toThrow(
      /control characters/,
    )
    const big = 'B'.repeat(PROXY_AUTH_VALUE_MAX_BYTES + 1)
    expect(() => parseProxyAuthorizationValue(big)).toThrow(
      new RegExp(`exceeds ${PROXY_AUTH_VALUE_MAX_BYTES}`),
    )
  })
})

describe('densable 2.1.238 #5 VtC file/command minter', () => {
  test('file minter reads utf8 value', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'f4y-file-'))
    const path = join(dir, 'auth')
    await writeFile(path, '  Bearer from-file\n')
    try {
      const minter = createProxyAuthorizationMinter({
        source: { kind: 'file', path },
        upstreamProxyUrl: 'http://egress:3128',
      })
      expect(await minter.mint()).toBe('Bearer from-file')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('file minter stall-locks a hung read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'f4y-fifo-'))
    const fifo = join(dir, 'auth.fifo')
    execFileSync('mkfifo', [fifo])
    const minter = createProxyAuthorizationMinter({
      source: { kind: 'file', path: fifo },
      upstreamProxyUrl: 'http://egress:3128',
      commandTimeoutMs: 80,
    })
    const first = minter.mint()
    await expect(first).rejects.toThrow(/could not be read/)
    await expect(minter.mint()).rejects.toThrow(/stalled mount/)
    const writer = createWriteStream(fifo)
    writer.write('Bearer unblocked\n')
    writer.end()
    await new Promise<void>(resolve => writer.once('close', () => resolve()))
    await rm(dir, { recursive: true, force: true })
  })

  test('command minter uses stdout + injects CLAUDE_CODE_PROXY_URL', async () => {
    const minter = createProxyAuthorizationMinter({
      source: {
        kind: 'command',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: shell interpolates CLAUDE_CODE_PROXY_URL at mint time
        command: 'printf "%s" "Bearer ${CLAUDE_CODE_PROXY_URL}"',
      },
      upstreamProxyUrl: 'http://egress:3128',
      commandEnv: () => ({ PATH: process.env.PATH }),
    })
    expect(await minter.mint()).toBe('Bearer http://egress:3128')
  })

  test('command minter failed exit names the code', async () => {
    const minter = createProxyAuthorizationMinter({
      source: { kind: 'command', command: 'exit 7' },
      upstreamProxyUrl: 'http://egress:3128',
      commandEnv: () => ({ PATH: process.env.PATH }),
    })
    await expect(minter.mint()).rejects.toThrow(/exited 7/)
  })

  test('commandEnv wipes runner secrets (F4y trC overlay)', async () => {
    const minter = createProxyAuthorizationMinter({
      source: {
        kind: 'command',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: shell interpolates runner secret (must stay ABSENT)
        command: 'printf "%s" "${SELF_HOSTED_RUNNER_POOL_SECRET:-ABSENT}"',
      },
      upstreamProxyUrl: 'http://egress:3128',
      commandEnv: () => ({
        PATH: process.env.PATH,
        SELF_HOSTED_RUNNER_POOL_SECRET: undefined,
        SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET: undefined,
      }),
    })
    expect(await minter.mint()).toBe('ABSENT')
  })
})

describe('densable 2.1.238 #5 erC/trC/H4y rewrite', () => {
  test('rewrites set keys; trC restores originals; H4y overlays', () => {
    setEnv('HTTPS_PROXY', 'http://up-https:1')
    setEnv('http_proxy', 'http://up-http:2')
    setEnv('ALL_PROXY', 'http://all:3')
    setEnv(PROXY_AUTH_COMMAND_ENV, 'vault read')
    const listener = 'http://runner:secret@127.0.0.1:9'
    const state = rewriteProcessProxyEnv(listener)
    expect(state.rewritten.sort()).toEqual(['HTTPS_PROXY', 'http_proxy'])
    expect(process.env.HTTPS_PROXY).toBe(listener)
    expect(process.env.http_proxy).toBe(listener)
    expect(process.env.HTTP_PROXY).toBeUndefined()

    const cmdEnv = commandEnvWithOriginalProxy()
    expect(cmdEnv.HTTPS_PROXY).toBe('http://up-https:1')
    expect(cmdEnv.http_proxy).toBe('http://up-http:2')

    const overlay = sessionChildProxyEnvOverlay()
    expect(overlay.HTTPS_PROXY).toBe(listener)
    expect(overlay.http_proxy).toBe(listener)
    expect(overlay.HTTP_PROXY).toBeUndefined()
    expect(overlay[PROXY_AUTH_COMMAND_ENV]).toBeUndefined()
    expect(overlay[PROXY_AUTH_FILE_ENV]).toBeUndefined()
    expect(overlay.ALL_PROXY).toBeUndefined()
    expect(overlay.all_proxy).toBeUndefined()
    expect(overlay.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER).toBeUndefined()
  })

  test('H4y is {} when rewriteState unset', () => {
    expect(sessionChildProxyEnvOverlay()).toEqual({})
  })
})

describe('densable 2.1.238 #5 $4y orchestrator refuse', () => {
  test('flag / env throw TelemetrySafeError', () => {
    expect(() =>
      assertOrchestratorProxyAuthUnset([
        '--proxy-authorization-command',
        'echo x',
      ]),
    ).toThrow(TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    try {
      assertOrchestratorProxyAuthUnset(['--proxy-authorization-file', '/tmp/a'])
    } catch (err) {
      expect(err).toBeInstanceOf(
        TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      )
      expect((err as Error).message).toContain(
        'not yet supported with the orchestrator subcommand',
      )
      expect(
        (err as TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
          .telemetryMessage,
      ).toBe('proxy-authorization knob given to the orchestrator subcommand')
    }

    setEnv(PROXY_AUTH_COMMAND_ENV, ' echo tok ')
    expect(() => assertOrchestratorProxyAuthUnset([])).toThrow(
      PROXY_AUTH_COMMAND_ENV,
    )
  })

  test('unset is a no-op', () => {
    expect(() => assertOrchestratorProxyAuthUnset([])).not.toThrow()
  })
})

describe('densable 2.1.238 #5 hv redactor', () => {
  test('redacts URL userinfo', () => {
    expect(redactEgressProxyText('http://user:pass@egress:3128')).toBe(
      'http://***:***@egress:3128',
    )
  })
})

describe('densable 2.1.238 #5 ZtC loopback listener', () => {
  test('407 without loopback Basic; CONNECT mints to upstream', async () => {
    const minted: string[] = []
    const upstream = await startFakeUpstream((head, sock) => {
      expect(head).toContain('CONNECT example.com:443')
      expect(head).toContain('Proxy-Authorization: Bearer loop-tok')
      sock.end('HTTP/1.1 200 Connection Established\r\n\r\n')
    })
    const listener = await startEgressProxyListener({
      upstreamProxyUrl: `http://127.0.0.1:${upstream.port}`,
      minter: {
        source: 'command',
        mint: async () => {
          minted.push('Bearer loop-tok')
          return 'Bearer loop-tok'
        },
      },
      onStatus: () => {},
    })
    try {
      const unauth = await requestListener(
        listener.port,
        'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n',
      )
      expect(unauth).toContain('407 Proxy Authentication Required')
      expect(unauth).toContain(`Basic realm="${LOOPBACK_REALM}"`)
      expect(minted).toEqual([])

      const auth = loopbackAuthHeader(listener.url)
      const ok = await requestListener(
        listener.port,
        `CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: ${auth}\r\n\r\n`,
      )
      expect(ok).toContain('200 Connection Established')
      expect(minted).toEqual(['Bearer loop-tok'])
    } finally {
      await listener.close()
      await upstream.close()
    }
  })

  test('CONNECT 407 remints once with Proxy-Authenticate challenge', async () => {
    let connects = 0
    const challenges: Array<string | undefined> = []
    const upstream = await startFakeUpstream((head, sock) => {
      connects++
      if (connects === 1) {
        sock.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\n' +
            'Proxy-Authenticate: Basic realm="up"\r\n' +
            'Content-Length: 0\r\n\r\n',
        )
        return
      }
      sock.end('HTTP/1.1 200 Connection Established\r\n\r\n')
    })
    const listener = await startEgressProxyListener({
      upstreamProxyUrl: `http://127.0.0.1:${upstream.port}`,
      minter: {
        source: 'command',
        mint: async opts => {
          challenges.push(opts?.challenge)
          return 'Bearer remint-tok'
        },
      },
      onStatus: () => {},
    })
    try {
      const auth = loopbackAuthHeader(listener.url)
      const ok = await requestListener(
        listener.port,
        `CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: ${auth}\r\n\r\n`,
      )
      expect(ok).toContain('200 Connection Established')
      expect(connects).toBe(2)
      expect(challenges).toEqual([undefined, 'Basic realm="up"'])
    } finally {
      await listener.close()
      await upstream.close()
    }
  })

  test('plain HTTP 407 is not reminted', async () => {
    let hits = 0
    const upstream = await startFakeUpstream((_head, sock) => {
      hits++
      sock.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\n' +
          'Proxy-Authenticate: Basic realm="up"\r\n' +
          'Content-Length: 0\r\n\r\n',
      )
    })
    const listener = await startEgressProxyListener({
      upstreamProxyUrl: `http://127.0.0.1:${upstream.port}`,
      minter: {
        source: 'command',
        mint: async () => 'Bearer http-tok',
      },
      onStatus: () => {},
    })
    try {
      const auth = loopbackAuthHeader(listener.url)
      const res = await requestListener(
        listener.port,
        `GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\nProxy-Authorization: ${auth}\r\n\r\n`,
      )
      expect(res).toContain('502 Bad Gateway')
      expect(res).toContain('plain HTTP request')
      expect(hits).toBe(1)
    } finally {
      await listener.close()
      await upstream.close()
    }
  })

  test('TRACE 405 and Transfer-Encoding 501', async () => {
    const listener = await startEgressProxyListener({
      upstreamProxyUrl: 'http://127.0.0.1:9',
      minter: { source: 'command', mint: async () => 'Bearer x' },
      onStatus: () => {},
    })
    try {
      const auth = loopbackAuthHeader(listener.url)
      const trace = await requestListener(
        listener.port,
        `TRACE http://example.com/ HTTP/1.1\r\nHost: example.com\r\nProxy-Authorization: ${auth}\r\n\r\n`,
      )
      expect(trace).toContain('405 Method Not Allowed')
      const te = await requestListener(
        listener.port,
        `POST http://example.com/ HTTP/1.1\r\nHost: example.com\r\nProxy-Authorization: ${auth}\r\nTransfer-Encoding: chunked\r\n\r\n`,
      )
      expect(te).toContain('501 Not Implemented')
    } finally {
      await listener.close()
    }
  })

  test('reflected minted value is withheld as 502', async () => {
    const token = 'Bearer reflected-secret-token'
    const upstream = await startFakeUpstream((_head, sock) => {
      sock.end(
        `HTTP/1.1 403 Forbidden\r\nX-Debug: ${token}\r\nContent-Length: 0\r\n\r\n`,
      )
    })
    const listener = await startEgressProxyListener({
      upstreamProxyUrl: `http://127.0.0.1:${upstream.port}`,
      minter: { source: 'command', mint: async () => token },
      onStatus: () => {},
    })
    try {
      const auth = loopbackAuthHeader(listener.url)
      const res = await requestListener(
        listener.port,
        `CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Authorization: ${auth}\r\n\r\n`,
      )
      expect(res).toContain('502 Bad Gateway')
      expect(res).toContain('reflected the runner-minted Proxy-Authorization')
      expect(res).not.toContain('reflected-secret-token')
    } finally {
      await listener.close()
      await upstream.close()
    }
  })
})

describe('densable 2.1.238 #5 F4y enable + close', () => {
  test('rewrites HTTPS_PROXY; close does not restore process.env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'f4y-en-'))
    const path = join(dir, 'auth')
    await writeFile(path, 'Bearer f4y-tok')
    setEnv('HTTPS_PROXY', 'http://127.0.0.1:9')
    const statuses: string[] = []
    let handle
    try {
      handle = await enableEgressProxyAuth(
        {
          source: { kind: 'file', path },
          upstreamProxyUrl: 'http://127.0.0.1:9',
        },
        { onStatus: m => statuses.push(m) },
      )
      expect(process.env.HTTPS_PROXY).toBe(handle.url)
      expect(
        statuses.some(s => s.includes('[runner:egress-proxy] enabled:')),
      ).toBe(true)
      expect(sessionChildProxyEnvOverlay().HTTPS_PROXY).toBe(handle.url)
      await handle.close()
      // SEA close clears GAt/opu only — process.env stays on the loopback URL.
      expect(process.env.HTTPS_PROXY).toBe(handle.url)
      expect(sessionChildProxyEnvOverlay()).toEqual({})
    } finally {
      await handle?.close().catch(() => {})
      await rm(dir, { recursive: true, force: true })
    }
  })
})
