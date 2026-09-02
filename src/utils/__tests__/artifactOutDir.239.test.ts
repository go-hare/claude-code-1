/**
 * densable read_file / read_asset out_dir path (2.1.239).
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import {
  callArtifactReadAsset,
  callArtifactReadFile,
  extensionForContentType,
  isWindowsReservedPublishedSegment,
  normalizePublishedPath,
  resolveAssetOutStem,
  resolveFileOutDest,
  writeBytesExclusive,
} from '../../services/artifactAutoReact/index.js'
import { checkArtifactActionPermissions } from '../../../packages/builtin-tools/src/tools/ArtifactTool/permissions.js'

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`
const ASSET_ID = 'a'.repeat(32)

const authMock = {
  getClaudeAIOAuthTokens: mock(() => ({
    accessToken: 'test-oauth',
  })),
}
mock.module('../../utils/auth.js', () => authMock)
mock.module('src/utils/auth.js', () => authMock)

function scratchDir(name: string): string {
  const dir = join(process.cwd(), `.tmp-${name}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

afterEach(() => {
  delete process.env.CLAUDE_CODE_ARTIFACT_FILES_DIR
})

function fakeContext() {
  return {
    abortController: new AbortController(),
    toolUseId: 'tu-out',
    getAppState: () => ({
      toolPermissionContext: { mode: 'default' },
    }),
    setAppState: () => {},
  } as never
}

describe('AWt / EWt out_dir resolve (239)', () => {
  test('normalizePublishedPath rejects service views and ..', () => {
    expect(normalizePublishedPath('_blob/x')).toMatchObject({
      errMsg: expect.stringContaining('own views'),
    })
    expect(normalizePublishedPath('../x')).toMatchObject({
      errMsg: expect.any(String),
    })
    expect(normalizePublishedPath('docs/a.md')).toEqual({ key: 'docs/a.md' })
  })

  test('Windows reserved device segments (CON/PRN/COM1) are rejected', () => {
    expect(isWindowsReservedPublishedSegment('CON')).toBe(true)
    expect(isWindowsReservedPublishedSegment('con.txt')).toBe(true)
    expect(isWindowsReservedPublishedSegment('PRN')).toBe(true)
    expect(isWindowsReservedPublishedSegment('NUL')).toBe(true)
    expect(isWindowsReservedPublishedSegment('COM1')).toBe(true)
    expect(isWindowsReservedPublishedSegment('LPT1')).toBe(true)
    expect(isWindowsReservedPublishedSegment('docs')).toBe(false)
    expect(isWindowsReservedPublishedSegment('console.md')).toBe(false)
    if (process.platform === 'win32') {
      expect(normalizePublishedPath('CON')).toMatchObject({
        errMsg: expect.stringContaining('reserved device name'),
      })
      expect(normalizePublishedPath('aux/readme.md')).toMatchObject({
        errMsg: expect.stringContaining('reserved device name'),
      })
    }
  })

  test('AWt joins out_dir + published path segments', () => {
    const base = scratchDir('art-awt')
    try {
      const r = resolveFileOutDest({
        url: URL,
        path: 'docs/a.md',
        out_dir: base,
      })
      expect('dest' in r && r.dest).toBe(join(base, 'docs', 'a.md'))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test('EWt joins out_dir + asset_id stem', () => {
    const base = scratchDir('art-ewt')
    try {
      const stem = resolveAssetOutStem({
        url: URL,
        asset_id: ASSET_ID,
        out_dir: base,
      })
      expect(stem).toBe(join(base, ASSET_ID))
      expect(extensionForContentType('image/png')).toBe('.png')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test('EWt omitted out_dir uses artifact-files/<slug>', () => {
    const stem = resolveAssetOutStem({
      url: URL,
      asset_id: ASSET_ID,
    })
    expect(stem).toBeDefined()
    expect(stem).toContain(SLUG)
    expect(stem).toContain(ASSET_ID)
  })

  test('writeBytesExclusive uses wx then rename', async () => {
    const base = scratchDir('art-wx')
    try {
      const dest = join(base, 'out.bin')
      await writeBytesExclusive(dest, Buffer.from('hello'))
      expect(readFileSync(dest, 'utf8')).toBe('hello')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('permissions ask/deny for out_dir (239)', () => {
  test('read_file missing path denies', async () => {
    const r = await checkArtifactActionPermissions(
      { action: 'read_file', url: URL },
      fakeContext(),
    )
    expect(r.behavior).toBe('deny')
    expect('message' in r ? String(r.message) : '').toContain('path')
  })

  test('read_file stamps __outDirPin on ask', async () => {
    const base = scratchDir('art-perm')
    try {
      const r = await checkArtifactActionPermissions(
        { action: 'read_file', url: URL, path: 'a.txt', out_dir: base },
        fakeContext(),
      )
      expect(r.behavior).toBe('ask')
      const pin = (r as { updatedInput?: { __outDirPin?: { stem: string } } })
        .updatedInput?.__outDirPin
      expect(pin?.stem).toBe(join(base, 'a.txt'))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test('read_asset bad id denies', async () => {
    const r = await checkArtifactActionPermissions(
      { action: 'read_asset', url: URL, asset_id: 'nope' },
      fakeContext(),
    )
    expect(r.behavior).toBe('deny')
  })
})

describe('save call body with mocked content-host (239)', () => {
  test('read_file fetches and writes under out_dir', async () => {
    const base = scratchDir('art-rf')
    const prev = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input)
      if (u.includes('/api/frame/') && !u.includes('claudeusercontent')) {
        return new Response(
          JSON.stringify({
            ver: 'v1',
            assetToken: 'atok',
            perm: { role: 'owner' },
          }),
          { status: 200 },
        )
      }
      if (u.includes('claudeusercontent.com') && u.includes('/docs/a.md')) {
        return new Response('file-body', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      }
      return new Response('miss', { status: 404 })
    }) as typeof fetch
    try {
      const r = await callArtifactReadFile({
        url: URL,
        path: 'docs/a.md',
        out_dir: base,
        pin: {
          action: 'read_file',
          slug: SLUG,
          stem: join(base, 'docs', 'a.md'),
          path: 'docs/a.md',
        },
      })
      if (!('data' in r)) throw new Error(r.error)
      expect(r.data.file_read.dest).toBe(join(base, 'docs', 'a.md'))
      expect(readFileSync(r.data.file_read.dest, 'utf8')).toBe('file-body')
    } finally {
      globalThis.fetch = prev
      rmSync(base, { recursive: true, force: true })
    }
  })

  test('read_asset appends SGi ext and writes', async () => {
    const base = scratchDir('art-ra')
    const prev = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input)
      if (u.includes('/api/frame/') && !u.includes('claudeusercontent')) {
        return new Response(
          JSON.stringify({
            ver: 'v1',
            assetToken: 'atok',
            perm: { role: 'owner' },
          }),
          { status: 200 },
        )
      }
      if (u.includes('_blob/')) {
        return new Response(Buffer.from([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      return new Response('miss', { status: 404 })
    }) as typeof fetch
    try {
      const stem = join(base, ASSET_ID)
      const r = await callArtifactReadAsset({
        url: URL,
        asset_id: ASSET_ID,
        out_dir: base,
        pin: {
          action: 'read_asset',
          slug: SLUG,
          stem,
          assetId: ASSET_ID,
        },
      })
      if (!('data' in r)) throw new Error(r.error)
      expect(r.data.asset_read.path).toBe(`${stem}.png`)
      expect(readFileSync(r.data.asset_read.path).length).toBe(4)
    } finally {
      globalThis.fetch = prev
      rmSync(base, { recursive: true, force: true })
    }
  })

  test('pin mismatch refuses without fetch write', async () => {
    const base = scratchDir('art-pin')
    try {
      const r = await callArtifactReadFile({
        url: URL,
        path: 'a.txt',
        out_dir: base,
        pin: {
          action: 'read_file',
          slug: SLUG,
          stem: join(base, 'OTHER.txt'),
          path: 'a.txt',
        },
      })
      expect('error' in r && r.error).toContain('no longer names')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
