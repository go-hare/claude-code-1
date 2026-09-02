/**
 * densable Artifact rest actions 2.1.239 — watch/status/assets/verify/delete/room_send.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  callArtifactStatus,
  callArtifactUnwatch,
  callArtifactWatch,
  isArtifactVerifyGateOpen,
  resetArtifactAutoReactStoreForTests,
  resetArtifactRoomHostForTests,
  sendArtifactRoomEvent,
  setArtifactRoomHost,
  un,
} from '../../services/artifactAutoReact/index.js'
import {
  checkArtifactActionPermissions,
  isArtifactActionConcurrencySafe,
  isArtifactActionReadOnly,
} from '../../../packages/builtin-tools/src/tools/ArtifactTool/permissions.js'

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`

const authMock = {
  getClaudeAIOAuthTokens: mock(() => ({
    accessToken: 'test-oauth',
  })),
}
mock.module('../../utils/auth.js', () => authMock)
mock.module('src/utils/auth.js', () => authMock)

afterEach(() => {
  resetArtifactAutoReactStoreForTests()
  resetArtifactRoomHostForTests()
  delete process.env.CLAUDE_CODE_ARTIFACT_VERIFY
  delete process.env.CLAUDE_CODE_ARTIFACT_DELETE
  delete process.env.CLAUDE_CODE_ARTIFACT_LIVE_SUBSCRIBE
})

function fakeContext(mode = 'default') {
  return {
    abortController: new AbortController(),
    toolUseId: 'tu-1',
    getAppState: () => ({
      toolPermissionContext: { mode },
    }),
    setAppState: () => {},
  } as never
}

describe('Artifact watch / unwatch / status (239)', () => {
  test('status returns empty watches by default', async () => {
    const r = await callArtifactStatus({})
    expect(r.data.watches).toEqual([])
  })

  test('unwatch latches stop and reports was_watching false when idle', async () => {
    const r = await callArtifactUnwatch({
      url: URL,
      context: { abortController: new AbortController() },
    })
    expect('data' in r && r.data.unwatch.was_watching).toBe(false)
    expect(un().durable.stopLatches.isStopped(SLUG)).toBe(true)
  })

  test('watch skips when stop-latched', async () => {
    un().durable.stopLatches.confirmStop(SLUG)
    const r = await callArtifactWatch({
      url: URL,
      context: { abortController: new AbortController() },
      setAppState: () => {},
    })
    expect('data' in r && r.data.watch).toMatchObject({
      watching: false,
      outcome: 'skipped',
      reason: 'stop_latched',
    })
  })

  test('watch permissions ask; stop-latched uses safetyCheck', async () => {
    const ask = await checkArtifactActionPermissions(
      { action: 'watch', url: URL },
      fakeContext(),
    )
    expect(ask.behavior).toBe('ask')
    un().durable.stopLatches.confirmStop(SLUG)
    const re = await checkArtifactActionPermissions(
      { action: 'watch', url: URL },
      fakeContext(),
    )
    expect(re.behavior).toBe('ask')
    expect(re.decisionReason?.type).toBe('safetyCheck')
  })
})

describe('Artifact verify / room_send / read_page_data gates (239)', () => {
  test('verify gate default closed', () => {
    expect(isArtifactVerifyGateOpen()).toBe(false)
  })

  test('verify permissions deny when mao closed', async () => {
    const r = await checkArtifactActionPermissions(
      { action: 'verify', url: URL },
      fakeContext(),
    )
    expect(r).toMatchObject({
      behavior: 'deny',
      message: 'verify is not available in this session.',
    })
  })

  test('room_send unbound host → unavailable result', () => {
    const r = sendArtifactRoomEvent(SLUG, 'ping', { a: 1 })
    expect(r).toEqual({ ok: false, reason: 'room_send_unavailable' })
  })

  test('room_send with bound host delivers', () => {
    setArtifactRoomHost({
      sendRoomEvent: () => ({ ok: true, peers: 2 }),
    })
    expect(sendArtifactRoomEvent(SLUG, 'ping', {})).toEqual({
      ok: true,
      peers: 2,
    })
  })

  test('read_page_data permissions deny schema unavailable', async () => {
    const r = await checkArtifactActionPermissions(
      { action: 'read_page_data', url: URL, schema: 'workshop' },
      fakeContext(),
    )
    expect(r.behavior).toBe('deny')
    expect('message' in r ? String(r.message) : '').toContain(
      'not available in this session',
    )
  })

  test('delete plan mode deny; concurrency/readOnly flags', async () => {
    const r = await checkArtifactActionPermissions(
      { action: 'delete', url: URL },
      fakeContext('plan'),
    )
    expect(r.behavior).toBe('deny')
    expect(isArtifactActionConcurrencySafe({ action: 'status' })).toBe(true)
    expect(isArtifactActionConcurrencySafe({ action: 'room_send' })).toBe(false)
    expect(isArtifactActionReadOnly({ action: 'watch' })).toBe(false)
    expect(isArtifactActionReadOnly({ action: 'list_assets' })).toBe(true)
  })

  test('unknown action denies; tip upload (no action) still allows', async () => {
    const unknown = await checkArtifactActionPermissions(
      { action: 'explode', url: URL },
      fakeContext(),
    )
    expect(unknown.behavior).toBe('deny')
    expect('message' in unknown ? String(unknown.message) : '').toContain(
      'explode',
    )

    const upload = await checkArtifactActionPermissions(
      { file_path: '/tmp/x.html' },
      fakeContext(),
    )
    expect(upload.behavior).toBe('allow')
  })
})

describe('Artifact list_assets / upload / delete via densable rxl (239)', () => {
  test('list_assets POSTs agent-list and maps opaque_id → _blob url', async () => {
    const id = 'a'.repeat(32)
    un().assetsOnRoster = true
    const prev = globalThis.fetch
    const seen: { method?: string; url?: string; body?: string } = {}
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen.method = init?.method
      seen.url = String(input)
      seen.body = typeof init?.body === 'string' ? init.body : undefined
      return new Response(
        JSON.stringify({
          assets: [
            {
              opaque_id: id,
              content_type: 'image/png',
              size_bytes: 12,
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
          usage: { files: 1, bytes: 12, max_files: 100, max_bytes: 50_000_000 },
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    try {
      const { listArtifactAssets } = await import(
        '../../services/artifactAutoReact/restApis.js'
      )
      const r = await listArtifactAssets({ slug: SLUG })
      expect(r.kind).toBe('ok')
      expect(seen.method).toBe('POST')
      expect(seen.url).toContain(`/api/frame/blob/${SLUG}/agent-list`)
      expect(seen.body).toContain('"limit":50')
      if (r.kind === 'ok') {
        expect(r.assets[0]).toMatchObject({
          id,
          url: `_blob/${id}`,
          contentType: 'image/png',
          sizeBytes: 12,
        })
        expect(r.usage.files).toBe(1)
      }
    } finally {
      globalThis.fetch = prev
    }
  })

  test('upload_asset POSTs raw bytes to agent-upload (not multipart)', async () => {
    const id = 'b'.repeat(32)
    un().assetsOnRoster = true
    const prev = globalThis.fetch
    const seen: {
      method?: string
      url?: string
      contentType?: string | null
      bodyIsForm?: boolean
      bodyLen?: number
    } = {}
    const { mkdtemp, writeFile, rm } = await import('fs/promises')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const dir = await mkdtemp(join(tmpdir(), 'artifact-rxl-'))
    const filePath = join(dir, 'dot.png')
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    await writeFile(filePath, bytes)
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen.method = init?.method
      seen.url = String(input)
      const headers = new Headers(init?.headers)
      seen.contentType = headers.get('content-type')
      seen.bodyIsForm = init?.body instanceof FormData
      if (init?.body instanceof Uint8Array || Buffer.isBuffer(init?.body)) {
        seen.bodyLen = (init.body as Uint8Array).byteLength
      } else if (typeof init?.body === 'string') {
        seen.bodyLen = Buffer.byteLength(init.body)
      }
      return new Response(
        JSON.stringify({
          opaque_id: id,
          size_bytes: bytes.length,
          content_type: 'image/png',
        }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    try {
      const { uploadArtifactAsset } = await import(
        '../../services/artifactAutoReact/restApis.js'
      )
      const r = await uploadArtifactAsset({ slug: SLUG, filePath })
      expect(r.kind).toBe('ok')
      expect(seen.method).toBe('POST')
      expect(seen.url).toContain(`/api/frame/blob/${SLUG}/agent-upload`)
      expect(seen.contentType).toBe('image/png')
      expect(seen.bodyIsForm).toBe(false)
      expect(seen.bodyLen).toBe(bytes.length)
      if (r.kind === 'ok') {
        expect(r.asset).toMatchObject({
          id,
          url: `_blob/${id}`,
          contentType: 'image/png',
          sizeBytes: bytes.length,
        })
      }
    } finally {
      globalThis.fetch = prev
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('delete_asset POSTs agent-delete (not HTTP DELETE /assets)', async () => {
    const id = 'c'.repeat(32)
    un().assetsOnRoster = true
    const prev = globalThis.fetch
    const seen: { method?: string; url?: string } = {}
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen.method = init?.method
      seen.url = String(input)
      return new Response(JSON.stringify({ deleted: true }), { status: 200 })
    }) as unknown as typeof fetch
    try {
      const { deleteArtifactAsset } = await import(
        '../../services/artifactAutoReact/restApis.js'
      )
      const r = await deleteArtifactAsset({ slug: SLUG, id })
      expect(r).toEqual({ kind: 'ok', deleted: true })
      expect(seen.method).toBe('POST')
      expect(seen.url).toContain(`/api/frame/blob/${SLUG}/${id}/agent-delete`)
      expect(seen.url).not.toContain('/api/frame/assets/')
    } finally {
      globalThis.fetch = prev
    }
  })

  test('REMOTE without sEe fails closed for asset rxl', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    const { setAssetRxlDepsForTests } = await import(
      '../../services/artifactAutoReact/assetRxl.js'
    )
    setAssetRxlDepsForTests({ isRelayOpen: () => false })
    try {
      const { listArtifactAssets } = await import(
        '../../services/artifactAutoReact/restApis.js'
      )
      const r = await listArtifactAssets({ slug: SLUG })
      expect(r.kind).toBe('error')
      if (r.kind === 'error') {
        expect(r.reason).toBe('relay_unavailable')
      }
    } finally {
      setAssetRxlDepsForTests(null)
      delete process.env.CLAUDE_CODE_REMOTE
    }
  })

  test('CLAUDE_CODE_REMOTE=0 does not trip relay_unavailable', async () => {
    process.env.CLAUDE_CODE_REMOTE = '0'
    un().assetsOnRoster = true
    const prev = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          assets: [],
          usage: {
            files: 0,
            bytes: 0,
            max_files: 100,
            max_bytes: 50_000_000,
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    try {
      const { listArtifactAssets } = await import(
        '../../services/artifactAutoReact/restApis.js'
      )
      const r = await listArtifactAssets({ slug: SLUG })
      expect(r.kind).toBe('ok')
    } finally {
      globalThis.fetch = prev
      delete process.env.CLAUDE_CODE_REMOTE
    }
  })

  test('wall-clock timeout soft-fails (does not throw AbortError)', async () => {
    un().assetsOnRoster = true
    const { setAssetRxlDepsForTests, assetRxl, assetAgentListRoute } =
      await import('../../services/artifactAutoReact/assetRxl.js')
    setAssetRxlDepsForTests({
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        await new Promise<void>((_resolve, reject) => {
          const t = setTimeout(() => {}, 60_000)
          init?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(t)
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        })
        return new Response('{}', { status: 200 })
      }) as unknown as typeof fetch,
    })
    try {
      const r = await assetRxl(
        {
          verb: 'list',
          route: assetAgentListRoute(SLUG),
          body: { limit: 50 },
          contentType: 'application/json',
          timeoutMs: 20,
        },
        undefined,
      )
      expect(r.replied).toBe(false)
      if (!r.replied) {
        expect(r.failure.reason).toBe('request_error')
        expect(r.failure.message).toContain('timed out')
      }
    } finally {
      setAssetRxlDepsForTests(null)
    }
  })

  test('roster AbortError propagates (does not soft-fail into POST)', async () => {
    resetArtifactAutoReactStoreForTests()
    const ac = new AbortController()
    ac.abort()
    const { assetRxl, assetAgentListRoute } = await import(
      '../../services/artifactAutoReact/assetRxl.js'
    )
    await expect(
      assetRxl(
        {
          verb: 'list',
          route: assetAgentListRoute(SLUG),
          body: { limit: 50 },
          contentType: 'application/json',
        },
        ac.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(un().assetsOnRoster).toBe(false)
  })

  test('delete_asset rejects uppercase asset id (densable UX)', async () => {
    const { deleteArtifactAsset } = await import(
      '../../services/artifactAutoReact/restApis.js'
    )
    const r = await deleteArtifactAsset({
      slug: SLUG,
      id: 'A'.repeat(32),
    })
    expect(r).toEqual({
      kind: 'error',
      message: 'invalid slug or asset_id',
      reason: 'input',
    })
  })

  test('malformed contract soft-fails and still POSTs agent-list', async () => {
    // densable Lwt malformed → mark, continue POST
    expect(un().assetsOnRoster).toBe(false)
    const prev = globalThis.fetch
    const urls: string[] = []
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('/api/frame/contract/latest')) {
        return new Response(JSON.stringify({ not: 'a contract' }), {
          status: 200,
        })
      }
      if (url.includes('/agent-list')) {
        return new Response(
          JSON.stringify({
            assets: [],
            usage: {
              files: 0,
              bytes: 0,
              max_files: 100,
              max_bytes: 50_000_000,
            },
          }),
          { status: 200 },
        )
      }
      return new Response('unexpected', { status: 500 })
    }) as unknown as typeof fetch
    try {
      const { listArtifactAssets } = await import(
        '../../services/artifactAutoReact/restApis.js'
      )
      const r = await listArtifactAssets({ slug: SLUG })
      expect(r.kind).toBe('ok')
      expect(urls.some(u => u.includes('/contract/latest'))).toBe(true)
      expect(urls.some(u => u.includes('/agent-list'))).toBe(true)
      // list success latches (densable ECm); malformed contract alone must not block POST
      expect(un().assetsOnRoster).toBe(true)
    } finally {
      globalThis.fetch = prev
    }
  })

  test('Fuw-ok contract without assets hard-fails with upload verb', async () => {
    resetArtifactAutoReactStoreForTests()
    expect(un().assetsOnRoster).toBe(false)
    const prev = globalThis.fetch
    let agentHit = false
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input)
      if (url.includes('/api/frame/contract/latest')) {
        return new Response(
          JSON.stringify({
            version: '1.0.0',
            capabilities: ['comments'],
          }),
          { status: 200 },
        )
      }
      if (url.includes('/agent-upload')) {
        agentHit = true
      }
      return new Response('no', { status: 500 })
    }) as unknown as typeof fetch
    const { mkdtemp, writeFile, rm } = await import('fs/promises')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const dir = await mkdtemp(join(tmpdir(), 'artifact-rxl-roster-'))
    const filePath = join(dir, 'dot.png')
    await writeFile(filePath, Buffer.from([1, 2, 3, 4]))
    try {
      const { uploadArtifactAsset } = await import(
        '../../services/artifactAutoReact/restApis.js'
      )
      const r = await uploadArtifactAsset({ slug: SLUG, filePath })
      expect(r.kind).toBe('error')
      if (r.kind === 'error') {
        expect(r.reason).toBe('roster_no_assets')
        expect(r.message).toContain('asset upload failed')
        expect(r.message).toContain(
          'artifact assets are not available to this account',
        )
        expect(r.message).not.toContain('roster_no_assets')
      }
      expect(agentHit).toBe(false)
      expect(un().assetsOnRoster).toBe(false)
    } finally {
      globalThis.fetch = prev
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('list_assets rejects malformed asset row (gMw all-or-nothing)', async () => {
    un().assetsOnRoster = true
    const prev = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          assets: [
            {
              opaque_id: 'a'.repeat(32),
              content_type: 'image/png',
              size_bytes: 12,
              created_at: '2026-01-01T00:00:00Z',
            },
            { opaque_id: 'bad', content_type: 'image/png', size_bytes: 1 },
          ],
          usage: { files: 2, bytes: 13, max_files: 100, max_bytes: 50_000_000 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    try {
      const { listArtifactAssets } = await import(
        '../../services/artifactAutoReact/restApis.js'
      )
      const r = await listArtifactAssets({ slug: SLUG })
      expect(r).toEqual({
        kind: 'error',
        message: 'the listing was unreadable',
        reason: 'malformed_reply',
      })
    } finally {
      globalThis.fetch = prev
    }
  })

  test('list_assets rejects numeric-string / null usage (no Number coerce)', async () => {
    un().assetsOnRoster = true
    const prev = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          assets: [],
          usage: {
            files: '0',
            bytes: null,
            max_files: 100,
            max_bytes: 50_000_000,
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    try {
      const { listArtifactAssets } = await import(
        '../../services/artifactAutoReact/restApis.js'
      )
      const r = await listArtifactAssets({ slug: SLUG })
      expect(r.kind).toBe('error')
      if (r.kind === 'error') expect(r.reason).toBe('malformed_reply')
    } finally {
      globalThis.fetch = prev
    }
  })

  test('upload_asset rejects bad sha256 echo (hMw)', async () => {
    const id = 'd'.repeat(32)
    un().assetsOnRoster = true
    const prev = globalThis.fetch
    const { mkdtemp, writeFile, rm } = await import('fs/promises')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const dir = await mkdtemp(join(tmpdir(), 'artifact-rxl-sha-'))
    const filePath = join(dir, 'dot.png')
    const bytes = Buffer.from([1, 2, 3, 4])
    await writeFile(filePath, bytes)
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          opaque_id: id,
          size_bytes: bytes.length,
          content_type: 'image/png',
          sha256: 'not-a-hash',
        }),
        { status: 200 },
      )) as unknown as typeof fetch
    try {
      const { uploadArtifactAsset } = await import(
        '../../services/artifactAutoReact/restApis.js'
      )
      const r = await uploadArtifactAsset({ slug: SLUG, filePath })
      expect(r).toMatchObject({ kind: 'error', reason: 'malformed_echo' })
    } finally {
      globalThis.fetch = prev
      await rm(dir, { recursive: true, force: true })
    }
  })
})
