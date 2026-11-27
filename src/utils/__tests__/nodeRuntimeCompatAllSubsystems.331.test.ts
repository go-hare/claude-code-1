import { describe, expect, spyOn, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  buildPluginScaffoldFiles,
  renderHookHandlerTs,
} from '../../cli/handlers/pluginScaffold.js'
import {
  createAuthProxy,
  createTcpAuthProxy,
  MAX_PROXY_REQUEST_BODY_BYTES,
} from '../../ssh/SSHAuthProxy.js'
import { triggerGcIfAvailable } from '../heapDumpService.js'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

type BunMutable = Record<string, unknown>

function withBunPropDisabled<T>(prop: string, fn: () => T): T {
  const bunObj = Bun as unknown as BunMutable
  const original = bunObj[prop]
  bunObj[prop] = undefined
  try {
    return fn()
  } finally {
    bunObj[prop] = original
  }
}

function stripCommentsAndStrings(source: string, keepStrings = false): string {
  // Strip block comments and line comments (and optionally single/double/template strings)
  // so static Bun.* audits only inspect executable code tokens.
  let out = ''
  let i = 0
  const len = source.length
  while (i < len) {
    const ch = source[i]!
    const next = source[i + 1]
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? len : end + 2
      continue
    }
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2)
      if (end === -1) break
      out += '\n'
      i = end + 1
      continue
    }
    if (!keepStrings && (ch === "'" || ch === '"' || ch === '`')) {
      const quote = ch
      i++
      while (i < len) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === quote) {
          i++
          break
        }
        if (source[i] === '\n') out += '\n'
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

describe('Node.js runtime compatibility across all subsystems (#331)', () => {
  describe('1. SSHAuthProxy node:http server (no Bun.serve)', () => {
    test('createTcpAuthProxy binds loopback 127.0.0.1:0, enforces nonce, injects auth, and stops cleanly without Bun.serve', async () => {
      const received: Array<{
        method: string | undefined
        url: string | undefined
        apiKey: string | string[] | undefined
        nonceHeader: string | string[] | undefined
        body: string
      }> = []

      const upstream: Server = createServer((req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          received.push({
            method: req.method,
            url: req.url,
            apiKey: req.headers['x-api-key'],
            nonceHeader: req.headers['x-auth-nonce'],
            body: Buffer.concat(chunks).toString('utf8'),
          })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, echoed: true }))
        })
      })

      await new Promise<void>(resolveListen => {
        upstream.listen(0, '127.0.0.1', () => resolveListen())
      })
      const addr = upstream.address()
      if (!addr || typeof addr === 'string') {
        throw new Error('Failed to resolve mock upstream port')
      }

      const prevBaseUrl = process.env.ANTHROPIC_BASE_URL
      const prevApiKey = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${addr.port}`
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-proxy-331'

      let proxyStop: (() => void) | undefined
      try {
        // SSHAuthProxy uses node:http.createServer directly (zero Bun.serve in source;
        // Bun's own node:http polyfill delegates to Bun.serve internally, so we invoke directly).
        const info = await createTcpAuthProxy('test-tcp-331')
        proxyStop = () => info.proxy.stop()

        expect(info.localAddress).toMatch(/^127\.0\.0\.1:\d+$/)
        expect(info.authEnv.ANTHROPIC_BASE_URL).toBe(
          `http://${info.localAddress}`,
        )
        const nonce = info.authEnv.ANTHROPIC_AUTH_NONCE
        expect(nonce).toBeTruthy()

        // Missing nonce -> 403 Forbidden
        const forbiddenRes = await fetch(
          `http://${info.localAddress}/v1/messages`,
          {
            method: 'POST',
            body: JSON.stringify({ hello: 'world' }),
          },
        )
        expect(forbiddenRes.status).toBe(403)
        expect(received.length).toBe(0)

        // Valid nonce -> proxied to upstream with injected x-api-key and stripped nonce
        const okRes = await fetch(
          `http://${info.localAddress}/v1/messages?beta=true`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-auth-nonce': nonce!,
            },
            body: JSON.stringify({ ping: 'pong' }),
          },
        )
        expect(okRes.status).toBe(200)
        expect(await okRes.json()).toEqual({ ok: true, echoed: true })

        expect(received.length).toBe(1)
        expect(received[0]).toEqual({
          method: 'POST',
          url: '/v1/messages?beta=true',
          apiKey: 'sk-ant-test-proxy-331',
          nonceHeader: undefined,
          body: JSON.stringify({ ping: 'pong' }),
        })

        info.proxy.stop()
        proxyStop = undefined
      } finally {
        proxyStop?.()
        upstream.close()
        if (prevBaseUrl === undefined) {
          delete process.env.ANTHROPIC_BASE_URL
        } else {
          process.env.ANTHROPIC_BASE_URL = prevBaseUrl
        }
        if (prevApiKey === undefined) {
          delete process.env.ANTHROPIC_API_KEY
        } else {
          process.env.ANTHROPIC_API_KEY = prevApiKey
        }
      }
    })

    test('rejects missing/wrong nonce BEFORE reading body and rejects oversize body with 413', async () => {
      const info = await createTcpAuthProxy('test-tcp-hardening-331')
      const [host, portStr] = info.localAddress.split(':')
      const port = Number(portStr)
      const nonce = info.authEnv.ANTHROPIC_AUTH_NONCE!

      const sendHeadersOnlyAndExpectStatus = (
        headers: Record<string, string>,
      ): Promise<{ status: number; rawHeaders: string }> =>
        new Promise((resolveReq, rejectReq) => {
          const sock = createConnection({ host, port }, () => {
            const headerLines = Object.entries(headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\r\n')
            // Send HTTP headers only without any body bytes
            sock.write(
              `POST /v1/messages HTTP/1.1\r\nHost: ${host}:${port}\r\n${headerLines}\r\n\r\n`,
            )
          })
          const timer = setTimeout(() => {
            sock.destroy()
            rejectReq(
              new Error(
                'Timed out waiting for early rejection before body completion',
              ),
            )
          }, 2_000)
          let buf = ''
          sock.on('data', chunk => {
            buf += chunk.toString('utf8')
            const headerEnd = buf.indexOf('\r\n\r\n')
            if (headerEnd === -1) return
            clearTimeout(timer)
            const rawHeaders = buf.slice(0, headerEnd)
            const match = /^HTTP\/\d\.\d\s+(\d{3})/.exec(rawHeaders)
            sock.destroy()
            resolveReq({
              status: match ? Number(match[1]) : 0,
              rawHeaders,
            })
          })
          sock.on('error', err => {
            clearTimeout(timer)
            rejectReq(err)
          })
        })

      try {
        // 1. Missing nonce with unfinished body -> immediate 403 without reading body
        const missingNonceRes = await sendHeadersOnlyAndExpectStatus({
          'Content-Length': '1048576',
        })
        expect(missingNonceRes.status).toBe(403)

        // 2. Wrong nonce (different length) with unfinished body -> immediate 403
        const wrongNonceRes = await sendHeadersOnlyAndExpectStatus({
          'x-auth-nonce': 'wrong',
          'Content-Length': '1048576',
        })
        expect(wrongNonceRes.status).toBe(403)

        // 3. Valid nonce + Content-Length > MAX_PROXY_REQUEST_BODY_BYTES -> fast-reject 413 + Connection: close
        const oversizeHeaderRes = await sendHeadersOnlyAndExpectStatus({
          'x-auth-nonce': nonce,
          'Content-Length': String(MAX_PROXY_REQUEST_BODY_BYTES + 1),
        })
        expect(oversizeHeaderRes.status).toBe(413)
        expect(oversizeHeaderRes.rawHeaders.toLowerCase()).toContain(
          'connection: close',
        )

        // 4. Valid nonce + chunked stream exceeding MAX_PROXY_REQUEST_BODY_BYTES -> 413
        const chunkedOversizeStatus = await new Promise<number>(
          (resolveReq, rejectReq) => {
            let settled = false
            const sock = createConnection({ host, port }, () => {
              sock.write(
                `POST /v1/messages HTTP/1.1\r\nHost: ${host}:${port}\r\nx-auth-nonce: ${nonce}\r\nTransfer-Encoding: chunked\r\n\r\n`,
              )
              const oneMiB = Buffer.alloc(1024 * 1024, 0x61)
              const chunkHeader = `${oneMiB.length.toString(16)}\r\n`
              const totalChunks =
                Math.floor(MAX_PROXY_REQUEST_BODY_BYTES / oneMiB.length) + 2
              for (let i = 0; i < totalChunks; i++) {
                sock.write(chunkHeader)
                sock.write(oneMiB)
                sock.write('\r\n')
              }
              sock.write('0\r\n\r\n')
            })
            let buf = ''
            sock.on('data', chunk => {
              if (settled) return
              buf += chunk.toString('utf8')
              const headerEnd = buf.indexOf('\r\n\r\n')
              if (headerEnd === -1) return
              settled = true
              const match = /^HTTP\/\d\.\d\s+(\d{3})/.exec(
                buf.slice(0, headerEnd),
              )
              sock.destroy()
              resolveReq(match ? Number(match[1]) : 0)
            })
            sock.on('error', err => {
              if (!settled) {
                settled = true
                rejectReq(err)
              }
            })
          },
        )
        expect(chunkedOversizeStatus).toBe(413)
      } finally {
        info.proxy.stop()
      }
    })

    test('createAuthProxy binds cleanly via node:http with 0o600 unix socket and cleans up on stop()', async () => {
      const info = await createAuthProxy()
      try {
        if (process.platform === 'win32') {
          expect(info.localAddress).toMatch(/^127\.0\.0\.1:\d+$/)
        } else {
          expect(info.authEnv.ANTHROPIC_UNIX_SOCKET).toBe(info.localAddress)
          expect(existsSync(info.localAddress)).toBe(true)
          expect(statSync(info.localAddress).mode & 0o777).toBe(0o600)
        }
      } finally {
        info.proxy.stop()
      }
      if (process.platform !== 'win32') {
        expect(existsSync(info.localAddress)).toBe(false)
      }
    })
  })

  describe('2. heapDumpService GC fallback', () => {
    test('uses Bun.gc(true) when available', () => {
      const spy = spyOn(Bun, 'gc').mockImplementation(() => {})
      try {
        expect(triggerGcIfAvailable()).toBe(true)
        expect(spy).toHaveBeenCalledWith(true)
      } finally {
        spy.mockRestore()
      }
    })

    test('falls back to globalThis.gc() when Bun.gc is unavailable', () => {
      const g = globalThis as unknown as { gc?: unknown }
      const originalGc = g.gc
      let called = 0
      g.gc = () => {
        called++
      }
      try {
        const ran = withBunPropDisabled('gc', () => triggerGcIfAvailable())
        expect(ran).toBe(true)
        expect(called).toBe(1)
      } finally {
        g.gc = originalGc
      }
    })

    test('returns false cleanly when neither Bun.gc nor globalThis.gc exists', () => {
      const g = globalThis as unknown as { gc?: unknown }
      const originalGc = g.gc
      g.gc = undefined
      try {
        const ran = withBunPropDisabled('gc', () => triggerGcIfAvailable())
        expect(ran).toBe(false)
      } finally {
        g.gc = originalGc
      }
    })
  })

  describe('3. pluginScaffold process.stdin hook template', () => {
    test('emits Node-compatible process.stdin reader instead of Bun.stdin and executes cleanly', () => {
      const template = renderHookHandlerTs()
      expect(template).not.toContain('Bun.stdin')
      expect(template).toContain('for await (const chunk of process.stdin)')

      const files = buildPluginScaffoldFiles({
        name: 'stdin-compat-plug',
        with: ['hooks'],
      })
      const hookFile = files.find(f =>
        f.relPath.endsWith('on-session-start.ts'),
      )
      expect(hookFile).toBeDefined()
      expect(hookFile!.contents).not.toContain('Bun.stdin')

      const dir = mkdtempSync(join(tmpdir(), 'plugin-scaffold-stdin-'))
      try {
        const scriptPath = join(dir, 'on-session-start.ts')
        writeFileSync(scriptPath, hookFile!.contents, 'utf8')
        const result = spawnSync(process.execPath, [scriptPath], {
          input: JSON.stringify({ event: 'SessionStart', session_id: 's1' }),
          encoding: 'utf8',
        })
        expect(result.status).toBe(0)
        expect(result.stdout).toBe('{}')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('4. build.ts & scripts/publish.ts win-sandbox-native vendor wiring', () => {
    test('build.ts copies optional srt-win(.exe) into dist/vendor/win-sandbox/', () => {
      const buildSrc = readFileSync(join(REPO_ROOT, 'build.ts'), 'utf8')
      expect(buildSrc).toContain("'srt-win.exe'")
      expect(buildSrc).toContain("'srt-win'")
      expect(buildSrc).toContain("'win-sandbox-native'")
      expect(buildSrc).toContain("'win-sandbox'")
      expect(buildSrc).toContain('existsSync(srcPath)')
      expect(buildSrc).toContain('Copied win-sandbox-native →')
    })

    test('scripts/publish.ts packages srt-win.exe into win32-* vendor/win-sandbox/ when built', () => {
      const publishSrc = readFileSync(
        join(REPO_ROOT, 'scripts/publish.ts'),
        'utf8',
      )
      expect(publishSrc).toContain('function copyWinSandboxToPlatformPkg')
      expect(publishSrc).toContain(
        "if (!platformKey.startsWith('win32')) return",
      )
      expect(publishSrc).toContain("const binaryName = 'srt-win.exe'")
      expect(publishSrc).toContain("'win-sandbox-native'")
      expect(publishSrc).toContain("'vendor', 'win-sandbox'")
      expect(publishSrc).toContain(
        'copyWinSandboxToPlatformPkg(targetPlatform)',
      )
    })
  })

  describe('5. Static audit: ZERO unguarded Bun.* calls in all 13 converted subsystem files', () => {
    const NODE_ONLY_FILES = [
      'src/daemon/bgManager.ts',
      'src/daemon/bgSpare.ts',
      'src/daemon/bgWorker.ts',
      'src/ssh/SSHAuthProxy.ts',
      'src/ssh/SSHDeploy.ts',
      'src/ssh/SSHProbe.ts',
      'src/ssh/createSSHSession.ts',
      'packages/acp-link/src/manager/manager.ts',
      'packages/workflow-engine/scripts/build.ts',
      'src/cli/handlers/pluginScaffold.ts',
      'src/utils/ripgrep.ts',
    ] as const

    const GUARDED_BUN_FILES = [
      'src/daemon/ptyHost.ts',
      'src/utils/heapDumpService.ts',
      'src/utils/storageV5/digestLog.ts',
    ] as const

    for (const relPath of NODE_ONLY_FILES) {
      test(`${relPath} has zero Bun.* code calls and zero "as any"`, () => {
        const src = readFileSync(join(REPO_ROOT, relPath), 'utf8')
        const codeOnly = stripCommentsAndStrings(src)
        expect(codeOnly.match(/\bBun\.\w+/g) ?? []).toEqual([])
        expect(codeOnly.match(/\bas\s+any\b/g) ?? []).toEqual([])
        // Also verify template/string payloads (e.g. pluginScaffold.ts) contain no Bun.stdin/Bun.spawn
        const noComments = stripCommentsAndStrings(src, true)
        expect(noComments).not.toContain('Bun.stdin')
      })
    }

    for (const relPath of GUARDED_BUN_FILES) {
      test(`${relPath} guards every Bun.* call behind typeof Bun !== 'undefined' and has zero "as any"`, () => {
        const src = readFileSync(join(REPO_ROOT, relPath), 'utf8')
        const codeOnly = stripCommentsAndStrings(src)
        expect(codeOnly.match(/\bas\s+any\b/g) ?? []).toEqual([])

        // Every Bun.<prop> reference in code must appear inside a block guarded by `typeof Bun !== 'undefined'`
        const lines = stripCommentsAndStrings(src, true).split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!
          if (!/\bBun\.\w+/.test(line)) continue
          // Look back up to 25 lines for a `typeof Bun !== 'undefined'` guard
          const windowStart = Math.max(0, i - 25)
          const preceding = lines.slice(windowStart, i + 1).join('\n')
          expect(preceding).toContain("typeof Bun !== 'undefined'")
        }
      })
    }
  })
})
