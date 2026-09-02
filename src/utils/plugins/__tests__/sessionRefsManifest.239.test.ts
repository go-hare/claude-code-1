import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  fetchSkillManifestOnce,
  fetchSkillManifestWithRetry,
  getSessionRefsStore,
  resetSessionRefsStoreForTests,
  SESSION_REFS_MANIFEST_RETRY_MS,
  SESSION_REFS_MANIFEST_TIMEOUT_MS,
  SESSION_REFS_SKILL_MANIFEST_PATH,
  sessionRefsManifestSchema,
  setSkillManifestGsGetForTests,
} from '../sessionRefsManifest.js'

afterEach(() => {
  resetSessionRefsStoreForTests()
})

describe('leftover 239 Uln / dCh / CFE / uCh / AFE', () => {
  test('AFE path + timeouts match gold', () => {
    expect(SESSION_REFS_SKILL_MANIFEST_PATH).toBe('/worker/skill-manifest')
    expect(SESSION_REFS_MANIFEST_TIMEOUT_MS).toBe(30_000)
    expect(SESSION_REFS_MANIFEST_RETRY_MS).toBe(500)
    const src = readFileSync(
      join(import.meta.dir, '../sessionRefsManifest.ts'),
      'utf8',
    )
    expect(src).toContain('/worker/skill-manifest')
    expect(src).toContain('anthropic-version')
    expect(src).toContain('validateStatus: () => true')
    expect(src).toContain('resolveSessionGatewayBaseUrl')
    expect(src).toContain('getSessionIngressAuthToken')
  })

  test('AFE nullish arrays + empty id filter + strict extra keys', () => {
    const empty = sessionRefsManifestSchema.safeParse({})
    expect(empty.success).toBe(true)
    if (empty.success) {
      expect(empty.data.skills).toEqual([])
      expect(empty.data.plugins).toEqual([])
    }
    const filled = sessionRefsManifestSchema.safeParse({
      plugins: [
        { id: 'keep', name: null, description: undefined },
        { id: '', name: 'drop' },
        { id: null, name: 'also-drop' },
      ],
    })
    expect(filled.success).toBe(true)
    if (filled.success) {
      expect(filled.data.plugins.map(row => row.id)).toEqual(['keep', '', ''])
      expect(filled.data.plugins[0]).toEqual({
        id: 'keep',
        name: '',
        description: '',
        version: '',
        directory: '',
      })
    }
    expect(
      sessionRefsManifestSchema.safeParse({ plugins: [], extra: 1 }).success,
    ).toBe(false)
  })

  test('uCh maps gs no-auth / other !ok / HTTP / parse', async () => {
    setSkillManifestGsGetForTests(async () => ({
      ok: false,
      reason: 'no-auth',
    }))
    expect(await fetchSkillManifestOnce()).toEqual({
      ok: false,
      reason: 'no_auth',
    })

    setSkillManifestGsGetForTests(async () => ({
      ok: false,
      reason: 'no_ingress',
    }))
    expect(await fetchSkillManifestOnce()).toEqual({
      ok: false,
      reason: 'gated',
    })

    setSkillManifestGsGetForTests(async () => ({
      ok: true,
      status: 503,
      data: {},
    }))
    expect(await fetchSkillManifestOnce()).toEqual({
      ok: false,
      reason: 'unavailable',
    })

    setSkillManifestGsGetForTests(async () => ({
      ok: true,
      status: 404,
      data: {},
    }))
    expect(await fetchSkillManifestOnce()).toEqual({
      ok: false,
      reason: 'http_error',
    })

    setSkillManifestGsGetForTests(async () => ({
      ok: true,
      status: 200,
      data: { plugins: [], extra: true },
    }))
    expect(await fetchSkillManifestOnce()).toEqual({
      ok: false,
      reason: 'malformed',
    })

    setSkillManifestGsGetForTests(async () => {
      throw new Error('socket')
    })
    expect(await fetchSkillManifestOnce()).toEqual({
      ok: false,
      reason: 'transport',
    })

    setSkillManifestGsGetForTests(async () => ({
      ok: true,
      status: 200,
      data: {
        plugins: [{ id: 'p1', directory: 'dir-a' }, { id: '' }],
        skills: [{ id: 's1' }],
      },
    }))
    const ok = await fetchSkillManifestOnce()
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.plugins).toEqual([
        {
          id: 'p1',
          name: '',
          description: '',
          version: '',
          directory: 'dir-a',
        },
      ])
      expect(ok.skills.map(row => row.id)).toEqual(['s1'])
    }
  })

  test('CFE does not retry ok / no_auth / gated', async () => {
    let calls = 0
    setSkillManifestGsGetForTests(async () => {
      calls++
      return { ok: false, reason: 'no-auth' }
    })
    expect(await fetchSkillManifestWithRetry()).toEqual({
      ok: false,
      reason: 'no_auth',
    })
    expect(calls).toBe(1)

    calls = 0
    setSkillManifestGsGetForTests(async () => {
      calls++
      return { ok: false, reason: 'no_ingress' }
    })
    expect(await fetchSkillManifestWithRetry()).toEqual({
      ok: false,
      reason: 'gated',
    })
    expect(calls).toBe(1)

    calls = 0
    setSkillManifestGsGetForTests(async () => {
      calls++
      return { ok: true, status: 200, data: { plugins: [], skills: [] } }
    })
    const ok = await fetchSkillManifestWithRetry()
    expect(ok).toEqual({ ok: true, plugins: [], skills: [] })
    expect(calls).toBe(1)
  })

  test('CFE retries once after unavailable', async () => {
    let calls = 0
    setSkillManifestGsGetForTests(async () => {
      calls++
      if (calls === 1) return { ok: true, status: 503, data: {} }
      return {
        ok: true,
        status: 200,
        data: { plugins: [{ id: 'after' }], skills: [] },
      }
    })
    const result = await fetchSkillManifestWithRetry()
    expect(calls).toBe(2)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.plugins.map(row => row.id)).toEqual(['after'])
  })

  test('listEntries fail-closed error is manifest <reason>', async () => {
    setSkillManifestGsGetForTests(async () => ({
      ok: false,
      reason: 'no-auth',
    }))
    const listed = await getSessionRefsStore().listEntries('plugins')
    expect(listed).toEqual({
      success: false,
      error: 'manifest no_auth',
    })
  })

  test('discardInflight drops the cached CFE so remint refetches', async () => {
    let resolveFirst: ((value: SkillManifestGsWait) => void) | undefined
    type SkillManifestGsWait = {
      ok: true
      status: number
      data: unknown
    }
    const firstGate = new Promise<SkillManifestGsWait>(resolve => {
      resolveFirst = resolve
    })
    let calls = 0
    setSkillManifestGsGetForTests(async () => {
      calls++
      if (calls === 1) return firstGate
      return {
        ok: true,
        status: 200,
        data: { plugins: [{ id: 'fresh' }], skills: [] },
      }
    })
    const store = getSessionRefsStore()
    const stale = store.listEntries('plugins')
    store.discardInflight()
    const fresh = store.listEntries('plugins')
    resolveFirst?.({
      ok: true,
      status: 200,
      data: { plugins: [{ id: 'stale' }], skills: [] },
    })
    const [staleResult, freshResult] = await Promise.all([stale, fresh])
    expect(staleResult.success && staleResult.entries[0]?.id).toBe('stale')
    expect(freshResult.success && freshResult.entries[0]?.id).toBe('fresh')
    expect(calls).toBe(2)
  })
})
