/**
 * densable iq / HLe / Ep / eH pin + read_file `paths` call (2.1.289).
 */
// Entering via outDirPaths first trips the tasks.ts → MonitorWsTask → restApis cycle.
import '../index.js'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getClaudeAIOAuthTokens } from 'src/utils/auth.js'
import { WRITE_STASH_EXPIRED } from 'src/utils/sessionSlots.js'
import {
  ARTIFACT_ASSET_TARGET_PIN,
  ARTIFACT_READ_FILE_MAX_PATHS,
  allPathsProtectedMessage,
  hasForeignArtifactPin,
  quotePublishedPath,
  readFileInputFields,
  resolveFileOutDests,
} from '../outDirPaths.js'
import {
  callArtifactReadAsset,
  callArtifactReadFile,
  callArtifactReadFileAction,
  callArtifactReadFiles,
  readFilePinMismatch,
} from '../saveActions.js'

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`
const ASSET_ID = 'c'.repeat(32)
const root = mkdtempSync(join(tmpdir(), 'artifact-multi-289-'))
const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
const prevFetch = globalThis.fetch

function clearTokenMemo(): void {
  ;(
    getClaudeAIOAuthTokens as unknown as { cache?: { clear?: () => void } }
  ).cache?.clear?.()
}

function contentHost(files: Record<string, string>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const u = String(input)
    if (u.includes('/api/frame/') && !u.includes('claudeusercontent')) {
      return new Response(
        JSON.stringify({
          ver: 'v7',
          assetToken: 'atok',
          perm: { role: 'owner' },
        }),
        { status: 200 },
      )
    }
    for (const [path, body] of Object.entries(files)) {
      if (
        u.includes('claudeusercontent.com') &&
        new globalThis.URL(u).pathname.endsWith(`/${path}`)
      ) {
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      }
    }
    return new Response('miss', { status: 404 })
  }) as typeof fetch
}

beforeAll(() => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-oauth'
  clearTokenMemo()
})

afterAll(() => {
  globalThis.fetch = prevFetch
  if (prevToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  else process.env.CLAUDE_CODE_OAUTH_TOKEN = prevToken
  clearTokenMemo()
  rmSync(root, { recursive: true, force: true })
})

describe('iq — read_file input fields', () => {
  test('paths keeps strings only; non-array is absent', () => {
    expect(
      readFileInputFields({ path: 'a', paths: ['x', 3, 'y'], out_dir: '/o' }),
    ).toEqual({ path: 'a', paths: ['x', 'y'], outDir: '/o' })
    expect(readFileInputFields({ paths: 'x' }).paths).toBeUndefined()
  })
})

describe('HLe — multi-path resolve', () => {
  test('resolves each path under one base', () => {
    const out = join(root, 'hle')
    expect(
      resolveFileOutDests({
        url: URL,
        out_dir: out,
        paths: ['a.md', 'd/b.md'],
      }),
    ).toEqual({
      base: out,
      files: [
        { path: 'a.md', dest: join(out, 'a.md') },
        { path: 'd/b.md', dest: join(out, 'd', 'b.md') },
      ],
    })
  })

  test('repeat and case-fold collisions are refused', () => {
    const out = join(root, 'hle')
    expect(
      resolveFileOutDests({ url: URL, out_dir: out, paths: ['a.md', 'a.md'] }),
    ).toEqual({ reason: '`paths` names "a.md" more than once' })
    expect(
      resolveFileOutDests({ url: URL, out_dir: out, paths: ['A.md', 'a.md'] }),
    ).toEqual({
      reason:
        '`paths` names "A.md" and "a.md", which could save to the same file on a case-insensitive volume; read one of them on its own',
    })
  })

  test('empty, too many, and a bad entry', () => {
    expect(resolveFileOutDests({ url: URL, paths: [] })).toEqual({
      reason:
        'read_file requires `path`, or `paths` naming at least one published path',
    })
    const many = Array.from(
      { length: ARTIFACT_READ_FILE_MAX_PATHS + 1 },
      (_, i) => `f${i}`,
    )
    expect(resolveFileOutDests({ url: URL, paths: many })).toEqual({
      reason: '`paths` names 257 paths; at most 256 can be read in one call',
    })
    const bad = resolveFileOutDests({ url: URL, paths: ['ok', '../x'] })
    expect('reason' in bad && bad.reason).toContain('not a safe published path')
  })

  test('memoized on the paths array identity', () => {
    const paths = ['m.md']
    const input = { url: URL, out_dir: join(root, 'memo'), paths }
    expect(resolveFileOutDests(input)).toBe(resolveFileOutDests(input))
  })
})

describe('Ep / Op', () => {
  test('quotes at most 8 paths then an ellipsis', () => {
    const msg = allPathsProtectedMessage(
      Array.from({ length: 9 }, (_, i) => `p${i}`),
    )
    expect(msg).toContain('"p7", \u2026)')
    expect(msg).not.toContain('"p8"')
    expect(msg).toEndWith('read them one at a time with `path`')
  })

  test('escapes non-printable and angle brackets', () => {
    expect(quotePublishedPath('a<b>\u00e9')).toBe('"a\\u003cb\\u003e\\u00e9"')
  })
})

describe('eH pin checks', () => {
  test('pin key and j5 foreign-pin detection', () => {
    expect(ARTIFACT_ASSET_TARGET_PIN).toBe('__artifactAssetTargetPin')
    expect(
      hasForeignArtifactPin(
        { __artifactPublishTarget: {} },
        ARTIFACT_ASSET_TARGET_PIN,
      ),
    ).toBe(true)
    expect(
      hasForeignArtifactPin(
        { [ARTIFACT_ASSET_TARGET_PIN]: {} },
        ARTIFACT_ASSET_TARGET_PIN,
      ),
    ).toBe(false)
  })

  test('single vs batch approval shapes', () => {
    const single = { action: 'read_file' as const, slug: SLUG, path: 'a.md' }
    expect(readFilePinMismatch(single, { path: 'a.md' })).toBe(false)
    expect(readFilePinMismatch(single, { path: 'b.md' })).toBe(true)
    expect(readFilePinMismatch(single, { paths: ['a.md'] })).toBe(true)
    const batch = {
      action: 'read_file' as const,
      slug: SLUG,
      paths: ['a.md'],
      skipped: ['.git/x'],
    }
    expect(readFilePinMismatch(batch, { paths: ['a.md', '.git/x'] })).toBe(
      false,
    )
    expect(readFilePinMismatch(batch, { paths: ['a.md'] })).toBe(true)
    expect(readFilePinMismatch(batch, { path: 'a.md' })).toBe(true)
  })

  test('a batch approval no longer matches a single-path call', async () => {
    const r = await callArtifactReadFile({
      url: URL,
      path: 'a.md',
      out_dir: join(root, 'x'),
      pin: { action: 'read_file', slug: SLUG, paths: ['a.md'] },
    })
    expect(r).toMatchObject({ reason: 'file_target_changed' })
  })

  test('a foreign pin on the input refuses before anything runs', async () => {
    const r = await callArtifactReadFiles({
      url: URL,
      paths: ['a.md'],
      out_dir: join(root, 'x'),
      toolInput: { __artifactDeletePin: { slug: SLUG } },
    })
    expect(r).toMatchObject({
      error:
        '`action`, `url`, or `path` no longer names what was approved \u2014 nothing was done; retry so it is checked again',
    })
  })

  test('stems that no longer match refuse before fetch', async () => {
    const out = join(root, 'stems')
    const r = await callArtifactReadFiles({
      url: URL,
      paths: ['a.md'],
      out_dir: out,
      pin: {
        action: 'read_file',
        slug: SLUG,
        paths: ['a.md'],
        stems: [join(out, 'other.md')],
      },
    })
    expect(r).toMatchObject({ reason: 'file_target_changed' })
    expect(existsSync(out)).toBe(false)
  })

  test('read_asset pin with another asset id is refused', async () => {
    const r = await callArtifactReadAsset({
      url: URL,
      asset_id: ASSET_ID,
      out_dir: join(root, 'asset'),
      pin: { action: 'read_asset', slug: SLUG, assetId: 'd'.repeat(32) },
    })
    expect(r).toMatchObject({ reason: 'asset_target_changed' })
  })
})

describe('read_file paths call (289)', () => {
  test('saves each file, reports per-file errors and set-aside entries', async () => {
    const out = join(root, 'batch')
    globalThis.fetch = contentHost({ 'a.md': 'A', 'd/b.md': 'BB' })
    const prepared: string[] = []
    const r = await callArtifactReadFileAction({
      url: URL,
      paths: ['a.md', 'gone.md', '.claude/settings.json', 'd/b.md'],
      out_dir: out,
      pin: {
        action: 'read_file',
        slug: SLUG,
        paths: ['a.md', 'gone.md', 'd/b.md'],
        stems: [
          join(out, 'a.md'),
          join(out, 'gone.md'),
          join(out, 'd', 'b.md'),
        ],
        skipped: ['.claude/settings.json'],
      },
      hooks: {
        takeBatchSpellings: (base, dests) => {
          expect(base).toBe(out)
          return dests.map(d => [d])
        },
        prepareWrite: async (dest, spellings, opts) => {
          prepared.push(dest)
          expect(spellings).toEqual([dest])
          expect(opts).toEqual({ createParents: true })
          const { mkdir } = await import('fs/promises')
          const { dirname } = await import('path')
          await mkdir(dirname(dest), { recursive: true })
          return {
            ioPath: dest,
            canonicalPath: dest,
            recheckBeforeWrite: async () => {},
            close: async () => {},
          }
        },
      },
    })
    if (!('data' in r) || !('files_read' in r.data)) {
      throw new Error(JSON.stringify(r))
    }
    const fr = r.data.files_read
    expect(fr.saved_dir).toBe(out)
    expect(fr.ver).toBe('v7')
    expect(fr.files.map(f => f.path)).toEqual([
      'a.md',
      'gone.md',
      '.claude/settings.json',
      'd/b.md',
    ])
    expect(fr.files[0]).toMatchObject({
      saved_to: join(out, 'a.md'),
      size_bytes: 1,
      content_type: 'text/plain',
    })
    expect('error' in fr.files[1]! && fr.files[1].error).toBeTruthy()
    expect(fr.files[2]).toEqual({
      path: '.claude/settings.json',
      error:
        'set aside: the approval set it aside \u2014 read it by itself with `path`',
    })
    expect(readFileSync(join(out, 'd', 'b.md'), 'utf8')).toBe('BB')
    expect(existsSync(join(out, '.claude'))).toBe(false)
    expect(prepared).toEqual([join(out, 'a.md'), join(out, 'd', 'b.md')])
  })

  test('an expired batch stash refuses before fetch', async () => {
    const r = await callArtifactReadFiles({
      url: URL,
      paths: ['a.md'],
      out_dir: join(root, 'expired'),
      hooks: { takeBatchSpellings: () => WRITE_STASH_EXPIRED },
    })
    expect(r).toMatchObject({ reason: 'file_read_write_moved' })
  })

  test('every destination protected (Ca null) → Ep refusal', async () => {
    const r = await callArtifactReadFiles({
      url: URL,
      paths: ['a.md', 'b.md'],
      out_dir: join(root, 'ca'),
      hooks: { planBatch: () => null },
    })
    expect(r).toEqual({
      error: allPathsProtectedMessage(['a.md', 'b.md']),
      reason: 'file_read_write_denied',
    })
  })

  test('an Edit deny on one destination names it', async () => {
    const out = join(root, 'deny')
    const r = await callArtifactReadFiles({
      url: URL,
      paths: ['a.md', 'b.md'],
      out_dir: out,
      hooks: { isWriteDenied: dest => dest.endsWith('b.md') },
    })
    expect(r).toEqual({
      error:
        '"b.md": writing it under out_dir is blocked by an Edit permission rule \u2014 nothing was fetched',
      reason: 'file_read_write_denied',
    })
  })

  test('a moved write target becomes a per-file error and leaves no temp file', async () => {
    const out = join(root, 'moved')
    globalThis.fetch = contentHost({ 'a.md': 'A' })
    const r = await callArtifactReadFiles({
      url: URL,
      paths: ['a.md'],
      out_dir: out,
      hooks: {
        prepareWrite: async dest => {
          const { mkdir } = await import('fs/promises')
          const { dirname } = await import('path')
          await mkdir(dirname(dest), { recursive: true })
          return {
            ioPath: dest,
            canonicalPath: dest,
            recheckBeforeWrite: async () => {
              const e = new Error('moved')
              e.name = 'SymlinkResolutionChangedError'
              throw e
            },
            close: async () => {},
          }
        },
      },
    })
    if (!('data' in r)) throw new Error(r.error)
    expect(r.data.files_read.files[0]).toEqual({
      path: 'a.md',
      error:
        'out_dir no longer resolves where it did when the save was approved \u2014 the file was fetched but not saved; retry so it is checked again',
    })
    expect(readdirSync(out)).toEqual([])
  })
})
