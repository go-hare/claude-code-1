import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { sleepSync } from '../../../packages/@ant/ink/src/core/ink.js'
import {
  canonicalizeGoalCondition,
  expandTabs,
} from '../../../packages/builtin-tools/src/tools/ProposeGoalTool/canonicalize.js'
import {
  runClipboardBinarySync,
  runClipboardBinaryWithNodeSpawnSync,
} from '../../../packages/image-processor-napi/src/index.js'
import { readStdinUpTo } from '../../cli/vscodeStdin.js'
import { fleetRemoteJobsStateEqual } from '../../screens/fleetView/fhFields.js'
import { transpileSurfaceSource } from '../plugins/functionHooksClient.js'
import {
  clearPluginToolRegistrarForTests,
  createNodePluginToolRegistrar,
} from '../plugins/pluginToolLoopbackRegistrar.js'
import {
  clearPluginToolRegistryForTests,
  setPluginRegisteredTool,
} from '../plugins/pluginToolRegistry.js'

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

async function withBunPropDisabledAsync<T>(
  prop: string,
  fn: () => Promise<T>,
): Promise<T> {
  const bunObj = Bun as unknown as BunMutable
  const original = bunObj[prop]
  bunObj[prop] = undefined
  try {
    return await fn()
  } finally {
    bunObj[prop] = original
  }
}

describe('Node.js runtime fallbacks for Bun.* production paths (#331)', () => {
  afterEach(() => {
    clearPluginToolRegistrarForTests()
    clearPluginToolRegistryForTests()
  })

  describe('1. ink.tsx sleepSync', () => {
    test('uses Bun.sleepSync fast path when available', () => {
      const spy = spyOn(Bun, 'sleepSync').mockImplementation(() => {})
      try {
        sleepSync(2)
        expect(spy).toHaveBeenCalledWith(2)
      } finally {
        spy.mockRestore()
      }
    })

    test('falls back to Atomics.wait when Bun.sleepSync is unavailable', () => {
      const waitSpy = spyOn(Atomics, 'wait')
      try {
        withBunPropDisabled('sleepSync', () => {
          sleepSync(2)
        })
        expect(waitSpy).toHaveBeenCalledTimes(1)
        const [, index, value, timeout] = waitSpy.mock.calls[0]!
        expect(index).toBe(0)
        expect(Number(value)).toBe(0)
        expect(timeout).toBe(2)
      } finally {
        waitSpy.mockRestore()
      }
    })

    test('falls back to busy-wait when SharedArrayBuffer is also unavailable', () => {
      const originalSab = globalThis.SharedArrayBuffer
      const g = globalThis as unknown as Record<string, unknown>
      g.SharedArrayBuffer = undefined
      try {
        const start = performance.now()
        withBunPropDisabled('sleepSync', () => {
          sleepSync(3)
        })
        const elapsed = performance.now() - start
        expect(elapsed).toBeGreaterThanOrEqual(2)
      } finally {
        g.SharedArrayBuffer = originalSab
      }
    })

    test('no-ops for non-positive durations', () => {
      const spy = spyOn(Bun, 'sleepSync').mockImplementation(() => {})
      try {
        sleepSync(0)
        sleepSync(-5)
        expect(spy).not.toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('2. fhFields.ts fleetRemoteJobsStateEqual', () => {
    test('uses node:util isDeepStrictEqual when Bun.deepEquals is unavailable', () => {
      const a = {
        state: 'running',
        inFlight: { kinds: ['bash', 'read'] },
        respawnFlags: ['--resume'],
        children: [{ kind: 'pr', href: 'https://example.com/1' }],
      }
      const b = {
        state: 'running',
        inFlight: { kinds: ['bash', 'read'] },
        respawnFlags: ['--resume'],
        children: [{ kind: 'pr', href: 'https://example.com/1' }],
      }
      const c = {
        state: 'running',
        inFlight: { kinds: ['bash', 'write'] },
        respawnFlags: ['--resume'],
        children: [{ kind: 'pr', href: 'https://example.com/1' }],
      }

      withBunPropDisabled('deepEquals', () => {
        expect(fleetRemoteJobsStateEqual(a, b)).toBe(true)
        expect(fleetRemoteJobsStateEqual(a, c)).toBe(false)
        expect(fleetRemoteJobsStateEqual(a, undefined)).toBe(false)
        expect(fleetRemoteJobsStateEqual(undefined, undefined)).toBe(true)
      })
    })
  })

  describe('3. image-processor-napi runClipboardBinarySync', () => {
    test('uses node:child_process spawnSync fallback when Bun.spawnSync is unavailable', () => {
      const dir = mkdtempSync(join(tmpdir(), 'clip-fallback-'))
      try {
        const okScript = join(dir, 'ok.sh')
        writeFileSync(okScript, '#!/bin/sh\nprintf "PNG_BYTES"\n')
        chmodSync(okScript, 0o755)

        const failScript = join(dir, 'fail.sh')
        writeFileSync(failScript, '#!/bin/sh\nexit 1\n')
        chmodSync(failScript, 0o755)

        const emptyScript = join(dir, 'empty.sh')
        writeFileSync(emptyScript, '#!/bin/sh\nexit 0\n')
        chmodSync(emptyScript, 0o755)

        // Verify Bun fast path first
        const bunResult = runClipboardBinarySync(okScript)
        expect(bunResult?.toString('utf8')).toBe('PNG_BYTES')

        // Verify Node spawnSync fallback directly (Bun's own node:child_process.spawnSync
        // delegates to Bun.spawnSync internally, so we invoke the Node fallback helper
        // without clobbering Bun.spawnSync underneath Bun's polyfill).
        expect(
          runClipboardBinaryWithNodeSpawnSync(okScript)?.toString('utf8'),
        ).toBe('PNG_BYTES')
        expect(runClipboardBinaryWithNodeSpawnSync(failScript)).toBeNull()
        expect(runClipboardBinaryWithNodeSpawnSync(emptyScript)).toBeNull()
        expect(
          runClipboardBinaryWithNodeSpawnSync(join(dir, 'does-not-exist')),
        ).toBeNull()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('4. pluginToolLoopbackRegistrar node:http fallback', () => {
    test('starts loopback HTTP server, enforces auth/method, serves MCP tools/list, and stops cleanly', async () => {
      setPluginRegisteredTool('node-plugin', {
        name: 'greet',
        description: 'Greet from node loopback',
        inputSchema: { type: 'object', properties: {} },
      })

      const registrar = createNodePluginToolRegistrar()
      const { key, config } = registrar('node-plugin', [
        {
          name: 'greet',
          description: 'Greet from node loopback',
          inputSchema: { type: 'object', properties: {} },
        },
      ])

      expect(key).toBe('node-plugin')
      expect(config.type).toBe('http')
      if (config.type !== 'http') {
        throw new Error('expected http config')
      }

      const parsedUrl = new URL(config.url)
      expect(Number(parsedUrl.port)).toBeGreaterThan(0)
      expect(registrar.serves?.(config.url)).toBe(true)
      expect(registrar.serves?.('http://127.0.0.1:1/node-plugin')).toBe(false)

      // Unauthenticated -> 404
      const unauthRes = await fetch(config.url, { method: 'POST' })
      expect(unauthRes.status).toBe(404)

      // Wrong method with valid auth -> 405 with Allow: POST
      const getRes = await fetch(config.url, {
        method: 'GET',
        headers: config.headers,
      })
      expect(getRes.status).toBe(405)
      expect(getRes.headers.get('allow')).toBe('POST')

      // Authenticated MCP tools/list POST -> 200 JSON-RPC response
      const listRes = await fetch(config.url, {
        method: 'POST',
        headers: {
          ...config.headers,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      })
      expect(listRes.status).toBe(200)
      const payload = (await listRes.json()) as {
        result?: {
          tools?: Array<{
            name: string
            description?: string
            inputSchema?: Record<string, unknown>
          }>
        }
      }
      expect(payload.result?.tools).toEqual([
        {
          name: 'greet',
          description: 'Greet from node loopback',
          inputSchema: { type: 'object', properties: {} },
        },
      ])

      clearPluginToolRegistrarForTests()
      expect(registrar.serves?.(config.url)).toBe(false)
    })
  })

  describe('5. functionHooksClient transpileSurfaceSource', () => {
    test('passes JS through and reports clear errors when Bun.Transpiler is unavailable', () => {
      const jsSource = 'export const x = 42;\n'
      const tsSource = 'export const x: number = 42;\n'
      const tsxSource = 'export const View = () => <box />;\n'
      const jsxSource = 'export const View = () => <box />;\n'

      // Bun fast path
      expect(transpileSurfaceSource('mod.js', jsSource)).toBe(jsSource)
      expect(transpileSurfaceSource('mod.ts', tsSource)).not.toContain(
        ': number',
      )
      expect(transpileSurfaceSource('mod.tsx', tsxSource)).toContain('h(')

      // Non-Bun fallback path
      withBunPropDisabled('Transpiler', () => {
        expect(transpileSurfaceSource('mod.js', jsSource)).toBe(jsSource)
        expect(transpileSurfaceSource('mod.mjs', jsSource)).toBe(jsSource)
        expect(() => transpileSurfaceSource('mod.tsx', tsxSource)).toThrow(
          /Bun\.Transpiler/,
        )
        expect(() => transpileSurfaceSource('mod.jsx', jsxSource)).toThrow(
          /Bun\.Transpiler/,
        )
        // In Bun, node:module.stripTypeScriptTypes is undefined, so .ts gives an informative error
        expect(() => transpileSurfaceSource('mod.ts', tsSource)).toThrow(
          /stripTypeScriptTypes|Bun\.Transpiler/,
        )
      })
    })
  })

  describe('6. vscodeStdin readStdinUpTo', () => {
    test('uses Readable.toWeb(process.stdin) fallback when Bun.stdin is unavailable', async () => {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        process,
        'stdin',
      )
      const setMockStdin = (chunks: Buffer[]) => {
        Object.defineProperty(process, 'stdin', {
          value: Readable.from(chunks),
          configurable: true,
          writable: true,
        })
      }

      try {
        await withBunPropDisabledAsync('stdin', async () => {
          setMockStdin([Buffer.from('hello '), Buffer.from('node')])
          expect(await readStdinUpTo(100)).toBe('hello node')

          setMockStdin([Buffer.from('0123456789abcdef')])
          expect(await readStdinUpTo(5)).toBeNull()

          setMockStdin([])
          expect(await readStdinUpTo(10)).toBe('')
        })
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(process, 'stdin', originalDescriptor)
        }
      }
    })
  })

  describe('7. ProposeGoalTool canonicalize stringWidth fallback', () => {
    test('expands ASCII and wide CJK tabs identically when Bun.stringWidth is unavailable', () => {
      const asciiTab = 'a\tb'
      const cjkTab = '中\tb'
      const noisy = '\u200B中\tb\u200B'

      const bunAscii = expandTabs(asciiTab)
      const bunCjk = expandTabs(cjkTab)
      const bunCanonical = canonicalizeGoalCondition(noisy)

      withBunPropDisabled('stringWidth', () => {
        expect(expandTabs(asciiTab)).toBe(bunAscii)
        expect(expandTabs(cjkTab)).toBe(bunCjk)
        expect(expandTabs(cjkTab)).toBe('中      b')
        expect(canonicalizeGoalCondition(noisy)).toBe(bunCanonical)
      })
    })
  })

  describe('8. heapDumpService Bun guard verification', () => {
    test('guards Bun.generateHeapSnapshot and Bun.gc behind typeof Bun !== undefined', () => {
      const source = readFileSync(
        join(import.meta.dir, '../heapDumpService.ts'),
        'utf8',
      )
      const guardIdx = source.indexOf("if (typeof Bun !== 'undefined')")
      const snapIdx = source.indexOf('Bun.generateHeapSnapshot')
      const gcIdx = source.indexOf('Bun.gc(')
      expect(guardIdx).toBeGreaterThan(-1)
      expect(snapIdx).toBeGreaterThan(guardIdx)
      expect(gcIdx).toBeGreaterThan(guardIdx)
    })
  })
})
