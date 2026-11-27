import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import {
  SandboxManager as BaseSandboxManager,
  type SandboxAskCallback,
  type SandboxRuntimeConfig,
} from '@anthropic-ai/sandbox-runtime'
import {
  checkAgentInlineMcpUrlSsrf,
  checkAgentInlineMcpUrlSsrfAsync,
} from '@claude-code/builtin-tools/tools/AgentTool/runAgent.js'
import axios from 'axios'
import { zipSync } from 'fflate'
import { Hono } from 'hono'
import { zstdCompressSync } from 'node:zlib'
import {
  createAuthFetch,
  wrapAuthFetchWithHeaders,
  wrapFetchWithOAuthRedirectGuard,
} from '../../../services/mcp/auth.js'
import { discoverOidc } from '../../../services/mcp/xaaIdpLogin.js'
import { unzipFile } from '../../dxt/zip.js'
import { downloadVersionFromBinaryRepo } from '../../nativeInstaller/download.js'
import {
  getBinaryName,
  getPlatform as getNativeInstallerPlatform,
} from '../../nativeInstaller/installer.js'
import {
  downloadPluginArchive,
  isAllowedArchiveUrl,
  isArchiveBlockedHostname,
} from '../../plugins/pluginArchive.js'
import {
  _resetSandboxHeldStateForTesting,
  _setSandboxInitFailureForTesting,
  ensureInitializedForWrap,
  hasSandboxStartedOnce,
  SandboxManager,
} from '../../sandbox/sandbox-adapter.js'
import { runWithNewHostSession, runWithSession } from '../../sessionHost.js'
import { settingsChangeDetector } from '../../settings/changeDetector.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import {
  assertHostNotSsrfBlocked,
  createSsrfGuardedLookup,
  expandIPv6Groups,
  isBlockedAddress,
  isBlockedHostnameOrIp,
  ssrfGuardedLookup,
} from '../ssrfGuard.js'

import { config as rcsConfig } from '../../../../packages/remote-control-server/src/config.js'
import { isWebSocketOriginAllowed } from '../../../../packages/remote-control-server/src/auth/cors.js'
import { issueToken } from '../../../../packages/remote-control-server/src/auth/token.js'
import acpRoutes from '../../../../packages/remote-control-server/src/routes/acp/index.js'
import v1SessionIngress from '../../../../packages/remote-control-server/src/routes/v1/session-ingress.js'
import webAuth from '../../../../packages/remote-control-server/src/routes/web/auth.js'
import webControl from '../../../../packages/remote-control-server/src/routes/web/control.js'
import webEnvironments from '../../../../packages/remote-control-server/src/routes/web/environments.js'
import webSessions from '../../../../packages/remote-control-server/src/routes/web/sessions.js'
import {
  storeCreateSession,
  storeCreateUser,
  storeReset,
} from '../../../../packages/remote-control-server/src/store.js'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')
const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('E5-P1-4 & E5-P2-4: Canonical ssrfGuard.ts (IPv6 NAT64 / zone / unspecified / mapped / compatible / ULA / RFC 1918)', () => {
  test('blocks IPv6 unspecified, NAT64, IPv4-compatible, IPv4-mapped, ULA, link-local with %zone, multicast, and private IPv4', () => {
    const alwaysBlocked = [
      // Unspecified
      '::',
      '0:0:0:0:0:0:0:0',
      '0000:0000:0000:0000:0000:0000:0000:0000',
      '0.0.0.0',
      '0.1.2.3',
      // Zone-scoped link-local & ULA
      'fe80::1%eth0',
      '[fe80::1%25en0]',
      'febf::dead:beef%lo0',
      'fd00:ec2::254%eth0',
      // Expanded ULA / AWS IMDSv2 IPv6
      'fd00:ec2:0:0:0:0:0:254',
      'fc00::1',
      'fdff:ffff::1',
      // NAT64 well-known (64:ff9b::/96) and local-use (64:ff9b:1::/48)
      '64:ff9b::169.254.169.254',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b::10.0.0.1',
      '64:ff9b::192.168.1.1',
      '64:ff9b::172.16.0.1',
      '64:ff9b:1::8.8.8.8',
      // IPv4-compatible (::/96)
      '::169.254.169.254',
      '::a9fe:a9fe',
      '::10.0.0.1',
      // IPv4-mapped (::ffff:0:0/96)
      '::ffff:169.254.169.254',
      '::ffff:a9fe:a9fe',
      '0:0:0:0:0:ffff:10.0.0.1',
      '0:0:0:0:0:ffff:c0a8:0101',
      // Multicast & site-local
      'ff02::1',
      'ff00::1',
      'fec0::1',
      // RFC 1918, CGNAT, link-local, multicast IPv4
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '100.64.0.1',
      '100.100.100.200',
      '169.254.169.254',
      '224.0.0.1',
      '240.0.0.1',
    ]

    for (const addr of alwaysBlocked) {
      expect(isBlockedAddress(addr, { allowLoopback: true })).toBe(true)
      expect(isBlockedAddress(addr, { allowLoopback: false })).toBe(true)
    }

    // Loopback policy toggle
    for (const loopback of [
      '127.0.0.1',
      '127.0.0.2',
      '::1',
      '0:0:0:0:0:0:0:1',
      '::ffff:127.0.0.1',
      '64:ff9b::127.0.0.1',
      '::127.0.0.1',
    ]) {
      expect(isBlockedAddress(loopback, { allowLoopback: true })).toBe(false)
      expect(isBlockedAddress(loopback, { allowLoopback: false })).toBe(true)
    }

    // Public IPv4 & IPv6 remain allowed
    for (const pub of [
      '93.184.216.34',
      '1.1.1.1',
      '2606:2800:220:1:248:1893:25c8:1946',
      '64:ff9b::93.184.216.34',
    ]) {
      expect(isBlockedAddress(pub, { allowLoopback: true })).toBe(false)
      expect(isBlockedAddress(pub, { allowLoopback: false })).toBe(false)
    }

    // Canonical group expansion sanity
    expect(expandIPv6Groups('64:ff9b::169.254.169.254')).toEqual([
      0x0064, 0xff9b, 0, 0, 0, 0, 0xa9fe, 0xa9fe,
    ])
    expect(expandIPv6Groups('[fe80::1%25en0]')).toEqual([
      0xfe80, 0, 0, 0, 0, 0, 0, 1,
    ])

    // Metadata & localhost hostnames
    expect(
      isBlockedHostnameOrIp('metadata.google.internal', {
        allowLoopback: true,
      }),
    ).toBe(true)
    expect(isBlockedHostnameOrIp('localhost', { allowLoopback: true })).toBe(
      false,
    )
    expect(isBlockedHostnameOrIp('localhost', { allowLoopback: false })).toBe(
      true,
    )
    expect(
      isBlockedHostnameOrIp('sub.localhost', { allowLoopback: false }),
    ).toBe(true)
  })

  test('assertHostNotSsrfBlocked blocks DNS responses resolving to private/IMDS IPs and allows public DNS', async () => {
    await expect(
      assertHostNotSsrfBlocked(
        '169.254.169.254.nip.io',
        { allowLoopback: false },
        async () => [{ address: '169.254.169.254', family: 4 }],
      ),
    ).rejects.toThrow(/SSRF guard/)

    await expect(
      assertHostNotSsrfBlocked(
        'dual-stack.evil.example',
        { allowLoopback: false },
        async () => [
          { address: '93.184.216.34', family: 4 },
          { address: 'fd00:ec2:0:0:0:0:0:254', family: 6 },
        ],
      ),
    ).rejects.toThrow(/SSRF guard/)

    await expect(
      assertHostNotSsrfBlocked(
        'public.example',
        { allowLoopback: false },
        async () => [{ address: '93.184.216.34', family: 4 }],
      ),
    ).resolves.toBeUndefined()
  })

  test('createSsrfGuardedLookup enforces policy synchronously on IP literals with zone IDs', async () => {
    const strictLookup = createSsrfGuardedLookup({ allowLoopback: false })
    const err1 = await new Promise<Error | null>(resolveCb => {
      strictLookup('fe80::1%eth0', { all: true }, err => resolveCb(err))
    })
    expect(err1).not.toBeNull()
    expect(err1?.message).toContain('SSRF guard')

    const err2 = await new Promise<Error | null>(resolveCb => {
      strictLookup('127.0.0.1', { all: true }, err => resolveCb(err))
    })
    expect(err2).not.toBeNull()

    const okLoopback = await new Promise<Error | null>(resolveCb => {
      ssrfGuardedLookup('127.0.0.1', { all: true }, err => resolveCb(err))
    })
    expect(okLoopback).toBeNull()
  })
})

describe('E5-P1-4: pluginArchive canonical SSRF guard (RFC 1918, full IPv6, DNS lookup wiring)', () => {
  test('blocks RFC 1918 IPv4, full IPv6 ULA/NAT64/zone forms, and passes SSRF lookup to axios', async () => {
    for (const host of [
      '10.0.0.1',
      '172.16.5.4',
      '192.168.0.10',
      '100.64.0.1',
      'fd00:ec2:0:0:0:0:0:254',
      '64:ff9b::169.254.169.254',
      'fe80::1%eth0',
      '0:0:0:0:0:0:0:0',
      'metadata.google.internal',
    ]) {
      expect(isArchiveBlockedHostname(host)).toBe(true)
    }

    expect(isAllowedArchiveUrl('https://10.0.0.1/plugin.zip')).toBe(false)
    expect(isAllowedArchiveUrl('https://192.168.1.5/plugin.zip')).toBe(false)
    expect(
      isAllowedArchiveUrl('https://[fd00:ec2:0:0:0:0:0:254]/plugin.zip'),
    ).toBe(false)
    expect(
      isAllowedArchiveUrl('https://[64:ff9b::169.254.169.254]/plugin.zip'),
    ).toBe(false)

    // Verify downloadPluginArchive wires a strict SSRF lookup callback into axios.get
    // (temporarily clear proxy env vars so the direct socket lookup path is exercised)
    const savedProxyEnv = {
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      https_proxy: process.env.https_proxy,
      HTTP_PROXY: process.env.HTTP_PROXY,
      http_proxy: process.env.http_proxy,
    }
    delete process.env.HTTPS_PROXY
    delete process.env.https_proxy
    delete process.env.HTTP_PROXY
    delete process.env.http_proxy
    let capturedLookup:
      | ((
          hostname: string,
          opts: object,
          cb: (err: Error | null, addr: unknown) => void,
        ) => void)
      | undefined
    const axiosSpy = spyOn(axios, 'get').mockImplementation(
      async (_url: string, cfg?: { lookup?: unknown }) => {
        capturedLookup = cfg?.lookup as typeof capturedLookup
        return { data: Buffer.from('PK') } as never
      },
    )
    try {
      await downloadPluginArchive('https://cdn.example.com/plugin.zip')
      expect(typeof capturedLookup).toBe('function')
      const blockedErr = await new Promise<Error | null>(resolveCb => {
        capturedLookup!('10.0.0.1', { all: true }, err => resolveCb(err))
      })
      expect(blockedErr).not.toBeNull()
      expect(blockedErr?.message).toContain('SSRF guard')
    } finally {
      axiosSpy.mockRestore()
      for (const [k, v] of Object.entries(savedProxyEnv)) {
        if (v === undefined) {
          delete process.env[k]
        } else {
          process.env[k] = v
        }
      }
    }
  })
})

/**
 * Builds a valid PKZIP archive containing `entryCount` central-directory entries
 * aliasing a single STORED (method 0) local file blob of `payloadSize` bytes,
 * with `uncompressedSize` (`originalSize`) spoofed to `0` in every header.
 *
 * Pre-decompression `filter` sees `file.originalSize === 0` for every entry
 * (`totalUncompressedSize === 0`), while `unzipSync` extracts `entryCount * payloadSize`
 * real bytes from a ~payloadSize archive (> 50:1 ratio).
 */
function buildSpoofedOriginalSizeZeroZipBomb(
  payloadSize: number,
  entryCount: number,
): Buffer {
  const localName = Buffer.from('a.txt', 'utf8')
  const payload = Buffer.alloc(payloadSize, 0x41)

  const localHeader = Buffer.alloc(30 + localName.length)
  localHeader.writeUInt32LE(0x04034b50, 0) // Local file header signature
  localHeader.writeUInt16LE(20, 4) // version needed
  localHeader.writeUInt16LE(0, 6) // flags
  localHeader.writeUInt16LE(0, 8) // method = 0 (STORED)
  localHeader.writeUInt16LE(0, 10) // mod time
  localHeader.writeUInt16LE(0, 12) // mod date
  localHeader.writeUInt32LE(0, 14) // crc32
  localHeader.writeUInt32LE(payloadSize, 18) // compressedSize
  localHeader.writeUInt32LE(0, 22) // SPOOFED uncompressedSize = 0
  localHeader.writeUInt16LE(localName.length, 26) // name len
  localHeader.writeUInt16LE(0, 28) // extra len
  localName.copy(localHeader, 30)

  const cdEntries: Buffer[] = []
  for (let i = 0; i < entryCount; i++) {
    const name = Buffer.from(`f${i}.txt`, 'utf8')
    const cd = Buffer.alloc(46 + name.length)
    cd.writeUInt32LE(0x02014b50, 0) // Central directory header signature
    cd.writeUInt16LE(20, 4) // version made by
    cd.writeUInt16LE(20, 6) // version needed
    cd.writeUInt16LE(0, 8) // flags
    cd.writeUInt16LE(0, 10) // method = 0 (STORED)
    cd.writeUInt16LE(0, 12) // mod time
    cd.writeUInt16LE(0, 14) // mod date
    cd.writeUInt32LE(0, 16) // crc32
    cd.writeUInt32LE(payloadSize, 20) // compressedSize
    cd.writeUInt32LE(0, 24) // SPOOFED uncompressedSize (originalSize) = 0
    cd.writeUInt16LE(name.length, 28) // name len
    cd.writeUInt16LE(0, 30) // extra len
    cd.writeUInt16LE(0, 32) // comment len
    cd.writeUInt16LE(0, 34) // disk number
    cd.writeUInt16LE(0, 36) // internal attr
    cd.writeUInt32LE(0, 38) // external attr
    cd.writeUInt32LE(0, 42) // local header offset = 0 (shared payload!)
    name.copy(cd, 46)
    cdEntries.push(cd)
  }

  const cdOffset = localHeader.length + payload.length
  const cdBlock = Buffer.concat(cdEntries)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // EOCD signature
  eocd.writeUInt16LE(0, 4) // disk
  eocd.writeUInt16LE(0, 6) // cd disk
  eocd.writeUInt16LE(entryCount, 8) // entries on disk
  eocd.writeUInt16LE(entryCount, 10) // total entries
  eocd.writeUInt32LE(cdBlock.length, 12) // cd size
  eocd.writeUInt32LE(cdOffset, 16) // cd offset
  eocd.writeUInt16LE(0, 20) // comment len

  return Buffer.concat([localHeader, payload, cdBlock, eocd])
}

describe('E5-P2-4: zip.ts spoofed originalSize: 0 zip bomb protection', () => {
  test('rejects zip bomb whose header originalSize is spoofed to 0 by enforcing actual decompressed byteLength', async () => {
    // 10KB stored payload referenced by 100 central-directory entries, all claiming originalSize: 0
    // Archive size ~15KB, actual extracted size = 1,000,000 bytes (~66:1 ratio > 50:1 limit)
    const spoofedBomb = buildSpoofedOriginalSizeZeroZipBomb(10_000, 100)

    await expect(unzipFile(spoofedBomb)).rejects.toThrow(
      /Suspicious compression ratio detected/,
    )

    // Normal legitimate zip still extracts cleanly
    const normalZip = Buffer.from(
      zipSync({
        'hello.txt': Buffer.from('hello world from normal zip'),
      }),
    )
    const extracted = await unzipFile(normalZip)
    expect(Buffer.from(extracted['hello.txt']!).toString('utf8')).toBe(
      'hello world from normal zip',
    )
  })
})

describe('E5-P1-4: xaaIdpLogin discoverOidc (authorization_endpoint scheme, RFC 8414 §3.3 issuer, redirect downgrade & SSRF)', () => {
  const allowPublicLookup: typeof ssrfGuardedLookup = (
    _hostname,
    _opts,
    cb,
  ) => {
    cb(null, [{ address: '93.184.216.34', family: 4 }])
  }

  test('rejects non-HTTPS authorization_endpoint, javascript: scheme, loopback http on https issuer, and RFC 8414 §3.3 issuer mismatch', async () => {
    const makeDiscoveryFetch = (payload: Record<string, unknown>) =>
      (async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch

    // 1. javascript: authorization_endpoint rejected
    await expect(
      discoverOidc('https://idp.example.com', {
        fetchFn: makeDiscoveryFetch({
          issuer: 'https://idp.example.com',
          authorization_endpoint: 'javascript:alert(1)',
          token_endpoint: 'https://idp.example.com/token',
        }),
        lookup: allowPublicLookup,
      }),
    ).rejects.toThrow(/refusing non-HTTPS authorization endpoint/)

    // 2. http://127.0.0.1 authorization_endpoint rejected for https:// issuer
    await expect(
      discoverOidc('https://idp.example.com', {
        fetchFn: makeDiscoveryFetch({
          issuer: 'https://idp.example.com',
          authorization_endpoint: 'http://127.0.0.1:8080/authorize',
          token_endpoint: 'https://idp.example.com/token',
        }),
        lookup: allowPublicLookup,
      }),
    ).rejects.toThrow(/refusing non-HTTPS authorization endpoint/)

    // 3. RFC 8414 §3.3 issuer mismatch rejected
    await expect(
      discoverOidc('https://idp.example.com', {
        fetchFn: makeDiscoveryFetch({
          issuer: 'https://evil-idp.example.com',
          authorization_endpoint: 'https://idp.example.com/authorize',
          token_endpoint: 'https://idp.example.com/token',
        }),
        lookup: allowPublicLookup,
      }),
    ).rejects.toThrow(/does not match configured issuer/)

    // 4. https -> http redirect downgrade rejected
    await expect(
      discoverOidc('https://idp.example.com', {
        fetchFn: (async () =>
          new Response(null, {
            status: 302,
            headers: {
              location:
                'http://idp.example.com/.well-known/openid-configuration',
            },
          })) as unknown as typeof fetch,
        lookup: allowPublicLookup,
      }),
    ).rejects.toThrow(/refusing HTTPS to HTTP redirect downgrade/)

    // 5. SSRF private IP blocked via ssrfGuardedLookup
    await expect(
      discoverOidc('https://169.254.169.254', {
        fetchFn: makeDiscoveryFetch({
          issuer: 'https://169.254.169.254',
          authorization_endpoint: 'https://169.254.169.254/authorize',
          token_endpoint: 'https://169.254.169.254/token',
        }),
      }),
    ).rejects.toThrow(/blocked SSRF target/)

    // 6. Valid HTTPS discovery succeeds
    const valid = await discoverOidc('https://idp.example.com', {
      fetchFn: makeDiscoveryFetch({
        issuer: 'https://idp.example.com/',
        authorization_endpoint: 'https://idp.example.com/authorize',
        token_endpoint: 'https://idp.example.com/token',
      }),
      lookup: allowPublicLookup,
    })
    expect(valid.authorization_endpoint).toBe(
      'https://idp.example.com/authorize',
    )
  })
})

describe('E5-P1-4: mcp/auth.ts HTTPS->HTTP downgrade guard and ssrfGuardedLookup wiring', () => {
  test('wrapAuthFetchWithHeaders, wrapFetchWithOAuthRedirectGuard, and createAuthFetch block https->http downgrade and SSRF', async () => {
    const serverConfig = {
      type: 'http' as const,
      url: 'https://mcp.example.com/mcp',
      headers: { 'X-Custom': 'val' },
    }

    // 1. wrapAuthFetchWithHeaders forbids https -> http downgrade on GET redirect
    const headerFetch = wrapAuthFetchWithHeaders(
      'srv',
      serverConfig,
      (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://mcp.example.com/downgraded' },
        })) as unknown as typeof fetch,
    )
    await expect(
      headerFetch(
        'https://mcp.example.com/.well-known/oauth-protected-resource',
      ),
    ).rejects.toThrow(/refusing HTTPS to HTTP redirect downgrade/)

    // 2. wrapFetchWithOAuthRedirectGuard forbids https -> http downgrade on GET
    const redirectGuarded = wrapFetchWithOAuthRedirectGuard(
      (async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'http://auth.example.com/metadata' },
        })) as unknown as typeof fetch,
    )
    await expect(
      redirectGuarded(
        'https://auth.example.com/.well-known/oauth-authorization-server',
      ),
    ).rejects.toThrow(/refusing HTTPS to HTTP redirect downgrade/)

    // 3. createAuthFetch blocks private/IMDS targets via ssrfGuardedLookup (both literal and DNS)
    let fetchCalled = false
    const authFetch = createAuthFetch({
      fetchFn: (async () => {
        fetchCalled = true
        return new Response('{}', { status: 200 })
      }) as unknown as typeof fetch,
      lookup: (hostname, _opts, cb) => {
        if (hostname === 'rebind.evil.example') {
          cb(
            Object.assign(
              new Error('Request blocked by SSRF guard: 169.254.169.254'),
              { code: 'ERR_HTTP_HOOK_BLOCKED_ADDRESS' },
            ),
            '',
          )
          return
        }
        cb(null, [{ address: '93.184.216.34', family: 4 }])
      },
    })
    await expect(
      authFetch('https://169.254.169.254/latest/meta-data'),
    ).rejects.toThrow(/blocked SSRF target/)
    await expect(
      authFetch('https://rebind.evil.example/.well-known/oauth'),
    ).rejects.toThrow(/SSRF guard/)
    expect(fetchCalled).toBe(false)
  })
})

describe('E5-P1-4: AgentTool inline MCP DNS SSRF check', () => {
  test('checkAgentInlineMcpUrlSsrfAsync blocks domains resolving to IMDS / RFC 1918 / ULA IPs', async () => {
    // Sync guard catches canonical IPv6 NAT64 / zone / unspecified
    expect(
      checkAgentInlineMcpUrlSsrf({
        type: 'http',
        url: 'https://[64:ff9b::169.254.169.254]/mcp',
      }).allowed,
    ).toBe(false)
    expect(
      checkAgentInlineMcpUrlSsrf({
        type: 'http',
        url: 'https://[0:0:0:0:0:0:0:0]/mcp',
      }).allowed,
    ).toBe(false)

    // Async DNS check catches DNS rebinding / nip.io pointing to IMDS or RFC 1918
    const imdsRes = await checkAgentInlineMcpUrlSsrfAsync(
      { type: 'http', url: 'https://169.254.169.254.nip.io/mcp' },
      { lookup: async () => [{ address: '169.254.169.254', family: 4 }] },
    )
    expect(imdsRes.allowed).toBe(false)
    if (!imdsRes.allowed) {
      expect(imdsRes.message).toContain('blocked DNS SSRF target')
    }

    const rfc1918Res = await checkAgentInlineMcpUrlSsrfAsync(
      { type: 'http', url: 'https://internal.corp.example/mcp' },
      { lookup: async () => [{ address: '10.20.30.40', family: 4 }] },
    )
    expect(rfc1918Res.allowed).toBe(false)

    const pubRes = await checkAgentInlineMcpUrlSsrfAsync(
      { type: 'http', url: 'https://mcp.public.example/mcp' },
      { lookup: async () => [{ address: '93.184.216.34', family: 4 }] },
    )
    expect(pubRes).toEqual({ allowed: true })
  })
})

describe('E4-P1-8: sandbox-adapter.ts HostSlot isolation for initializationPromise & settingsSubscriptionCleanup', () => {
  test('Host A init failure or reset never clobbers Host B initializationPromise or settingsSubscriptionCleanup', async () => {
    const tempConfigDir = makeTempDir('e5-sbx-hostslot-cfg-')
    writeFileSync(
      join(tempConfigDir, 'settings.json'),
      JSON.stringify({ sandbox: { enabled: true } }),
    )
    const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempConfigDir
    resetSettingsCache()

    const origInitialize = BaseSandboxManager.initialize
    const origUpdateConfig = BaseSandboxManager.updateConfig
    const origReset = BaseSandboxManager.reset
    const origCheckDeps = BaseSandboxManager.checkDependencies

    let updateCount = 0
    BaseSandboxManager.checkDependencies = () => ({ errors: [], warnings: [] })
    BaseSandboxManager.initialize = async (
      _cfg: SandboxRuntimeConfig,
      _ask?: SandboxAskCallback,
    ) => {}
    BaseSandboxManager.updateConfig = () => {
      updateCount += 1
    }
    BaseSandboxManager.reset = async () => {}

    await SandboxManager.reset()

    try {
      if (!SandboxManager.isSupportedPlatform()) {
        return
      }
      const wsA = makeTempDir('e5-sbx-a-')
      const wsB = makeTempDir('e5-sbx-b-')

      await runWithNewHostSession(
        { id: 'e5-host-a', cwd: wsA, originalCwd: wsA },
        async sessionA => {
          await SandboxManager.initialize()
          expect(hasSandboxStartedOnce()).toBe(true)

          await runWithNewHostSession(
            { id: 'e5-host-b', cwd: wsB, originalCwd: wsB },
            async () => {
              await SandboxManager.initialize()
              expect(hasSandboxStartedOnce()).toBe(true)

              // Simulate init failure in Host A ONLY — Host B's initializationPromise stays intact!
              await runWithSession(sessionA, async () => {
                _setSandboxInitFailureForTesting('host-a-only-failure')
                await expect(ensureInitializedForWrap()).rejects.toThrow(
                  /host-a-only-failure/,
                )
              })

              // Host B still passes ensureInitializedForWrap cleanly!
              await expect(ensureInitializedForWrap()).resolves.toBeUndefined()

              // Reset Host A: cleans up Host A's settings subscription ONLY
              await runWithSession(sessionA, async () => {
                await SandboxManager.reset()
              })

              // Settings change notification STILL triggers Host B's subscription (exactly 1 refresh, not 0 and not 2)
              const beforeNotify = updateCount
              settingsChangeDetector.notifyChange('userSettings')
              expect(updateCount - beforeNotify).toBe(1)

              await SandboxManager.reset()
              const afterBothReset = updateCount
              settingsChangeDetector.notifyChange('userSettings')
              expect(updateCount).toBe(afterBothReset)
            },
          )
        },
      )
    } finally {
      BaseSandboxManager.initialize = origInitialize
      BaseSandboxManager.updateConfig = origUpdateConfig
      BaseSandboxManager.reset = origReset
      BaseSandboxManager.checkDependencies = origCheckDeps
      _resetSandboxHeldStateForTesting()
      await SandboxManager.reset().catch(() => {})
      if (prevConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfigDir
      }
      resetSettingsCache()
    }
  })
})

describe('E5-P2-3: nativeInstaller download.ts bounded signedWireSize cap on .zst downloads', () => {
  test('aborts oversized .zst wire stream (skippable-frame DoS) at platformInfo.size + 64KiB and falls back safely to raw binary', async () => {
    const platform = getNativeInstallerPlatform()
    const binaryName = getBinaryName(platform)
    const rawBinary = Buffer.from('#!/bin/sh\necho safe-raw\n', 'utf8')
    const rawChecksum = sha256Hex(rawBinary)

    // Craft a valid small zstd payload preceded by huge skippable frames (512 KiB >> 64 KiB cap)
    const validZst = Buffer.from(zstdCompressSync(rawBinary))
    const skippablePayloadSize = 512 * 1024
    const skippableHeader = Buffer.alloc(8)
    skippableHeader.writeUInt32LE(0x184d2a50, 0) // ZSTD skippable frame magic
    skippableHeader.writeUInt32LE(skippablePayloadSize, 4)
    const dosZstStreamPayload = Buffer.concat([
      skippableHeader,
      Buffer.alloc(skippablePayloadSize, 0xaa),
      validZst,
    ])
    const zstChecksum = sha256Hex(dosZstStreamPayload)

    const manifest = {
      version: '2.1.331',
      platforms: {
        [platform]: {
          checksum: rawChecksum,
          size: rawBinary.length,
          binary: binaryName,
        },
      },
    }
    const zstManifest = {
      version: '2.1.331',
      platforms: {
        [platform]: { checksum: zstChecksum },
      },
    }

    let zstBytesConsumed = 0
    let fellBackToRaw = false
    const axiosSpy = spyOn(axios, 'get').mockImplementation(
      async (url: string) => {
        if (url.endsWith('/manifest.json')) {
          return { data: Buffer.from(JSON.stringify(manifest)) } as never
        }
        if (url.endsWith('/manifest.zst.json')) {
          return { data: zstManifest } as never
        }
        if (url.endsWith('.zst')) {
          // Stream in 16 KiB chunks so wireTransform aborts right after platformInfo.size + 64 KiB
          let offset = 0
          const stream = new Readable({
            highWaterMark: 16 * 1024,
            read() {
              if (offset >= dosZstStreamPayload.length) {
                this.push(null)
                return
              }
              const chunk = dosZstStreamPayload.subarray(
                offset,
                offset + 16 * 1024,
              )
              offset += chunk.length
              zstBytesConsumed += chunk.length
              this.push(chunk)
            },
          })
          return { data: stream } as never
        }
        fellBackToRaw = true
        return { data: Readable.from([rawBinary]) } as never
      },
    )

    try {
      const stageDir = makeTempDir('e5-zst-cap-')
      await downloadVersionFromBinaryRepo(
        '2.1.331',
        stageDir,
        'https://mirror.example.invalid',
        undefined,
        { signaturePolicy: 'skip' },
      )
      expect(fellBackToRaw).toBe(true)
      // Must abort well before consuming the full 512 KiB skippable-frame payload
      expect(zstBytesConsumed).toBeLessThan(256 * 1024)
      expect(readFileSync(join(stageDir, binaryName)).equals(rawBinary)).toBe(
        true,
      )
    } finally {
      axiosSpy.mockRestore()
    }
  })
})

describe('E5-P0-3 & E5-P2-5: Remote Control Server auth, permission_mode allowlist, CSRF guard, WS Origin & static source protection', () => {
  function createRcsTestApp(): Hono {
    const app = new Hono()
    app.route('/web', webAuth as unknown as Hono)
    app.route('/web', webSessions as unknown as Hono)
    app.route('/web', webControl as unknown as Hono)
    app.route('/web', webEnvironments as unknown as Hono)
    app.route('/acp', acpRoutes as unknown as Hono)
    app.route('/v1/session_ingress', v1SessionIngress as unknown as Hono)
    return app
  }

  test('requires API key or session token on /web/*, restricts permission_mode, enforces JSON Content-Type, enforces WS Origin, and never falls back to raw web/ source', async () => {
    storeReset()
    const origHost = rcsConfig.host
    const origAllowUnauth = process.env.RCS_ALLOW_UNAUTHENTICATED_UUID
    const origAllowDanger = process.env.RCS_ALLOW_DANGEROUS_PERMISSION_MODES
    delete process.env.RCS_ALLOW_UNAUTHENTICATED_UUID
    delete process.env.RCS_ALLOW_DANGEROUS_PERMISSION_MODES

    const app = createRcsTestApp()
    const session = storeCreateSession({ title: 'Test' })

    try {
      // 1. Unauthenticated /web/* requests with UUID-only are rejected with 401
      expect(
        (await app.request('/web/environments?uuid=attacker')).status,
      ).toBe(401)
      expect(
        (
          await app.request('/web/sessions?uuid=attacker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Unauth' }),
          })
        ).status,
      ).toBe(401)
      expect(
        (
          await app.request('/web/bind?uuid=attacker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: session.id }),
          })
        ).status,
      ).toBe(401)
      expect(
        (await app.request(`/web/sessions/${session.id}?uuid=attacker`)).status,
      ).toBe(401)

      // 2. Server-issued token works on /web/environments and /web/sessions
      storeCreateUser('alice')
      const { token } = issueToken('alice')
      const authHeaders = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
      expect(
        (
          await app.request('/web/environments', {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(200)

      // 3. permission_mode allowlist enforced on POST /web/sessions
      expect(
        (
          await app.request('/web/sessions', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ permission_mode: 'acceptEdits' }),
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await app.request('/web/sessions', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ permission_mode: 'bypassPermissions' }),
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await app.request('/web/sessions', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ permission_mode: 'dontAsk' }),
          })
        ).status,
      ).toBe(403)

      // 4. Non-JSON Content-Type rejected (text/plain CSRF guard) on mutating /web/* routes
      expect(
        (
          await app.request('/web/sessions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'text/plain',
            },
            body: JSON.stringify({ title: 'CSRF' }),
          })
        ).status,
      ).toBe(415)

      // 5. WebSocket Origin enforcement on /acp/ws, /acp/relay/:agentId, and /v1/session_ingress/ws/:id
      expect(isWebSocketOriginAllowed(undefined)).toBe(true)
      expect(
        isWebSocketOriginAllowed(`http://localhost:${rcsConfig.port}`),
      ).toBe(true)
      expect(isWebSocketOriginAllowed('https://evil.attacker.example')).toBe(
        false,
      )
      expect(isWebSocketOriginAllowed('null')).toBe(false)

      for (const wsPath of [
        '/acp/ws',
        '/acp/relay/agent_1',
        `/v1/session_ingress/ws/${session.id}`,
      ]) {
        const res = await app.request(wsPath, {
          headers: { Origin: 'https://evil.attacker.example' },
        })
        expect(res.status).toBe(403)
      }

      // 6. E5-P2-5: RCS src/index.ts never falls back to serving raw ../web source directory
      const rcsIndexSrc = readFileSync(
        join(REPO_ROOT, 'packages/remote-control-server/src/index.ts'),
        'utf8',
      )
      expect(rcsIndexSrc).not.toContain("resolve(__dirname, '../web')")
      expect(rcsIndexSrc).toContain('hasBuiltWebDist')
    } finally {
      ;(rcsConfig as { host: string }).host = origHost
      if (origAllowUnauth === undefined) {
        delete process.env.RCS_ALLOW_UNAUTHENTICATED_UUID
      } else {
        process.env.RCS_ALLOW_UNAUTHENTICATED_UUID = origAllowUnauth
      }
      if (origAllowDanger === undefined) {
        delete process.env.RCS_ALLOW_DANGEROUS_PERMISSION_MODES
      } else {
        process.env.RCS_ALLOW_DANGEROUS_PERMISSION_MODES = origAllowDanger
      }
    }
  })
})
