/**
 * densable 2.1.224 #2 — plugin archive source (schema + URL policy + version + extract)
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { zipSync } from 'fflate'
import {
  ARCHIVE_URL_POLICY_MESSAGE,
  hasPluginShapedRoot,
  installPluginArchiveToDirectory,
  isAllowedArchiveUrl,
  isArchiveBlockedHostname,
  isSameOrigin,
  promoteSingleWrapperDirectory,
} from '../pluginArchive.js'
import { calculatePluginVersion } from '../pluginVersioning.js'
import { PluginSourceSchema } from '../schemas.js'

const VALID_SHA = 'a'.repeat(64)
const VALID_URL = 'https://example.com/plugins/my-plugin.zip'

describe('densable 2.1.224 #2 archive URL policy (Lio / $Xr)', () => {
  test('https public host allowed', () => {
    expect(isAllowedArchiveUrl(VALID_URL)).toBe(true)
    expect(isAllowedArchiveUrl('https://cdn.example.org/a.zip')).toBe(true)
  })

  test('http rejected', () => {
    expect(isAllowedArchiveUrl('http://example.com/a.zip')).toBe(false)
  })

  test('loopback / localhost rejected', () => {
    expect(isArchiveBlockedHostname('localhost')).toBe(true)
    expect(isArchiveBlockedHostname('127.0.0.1')).toBe(true)
    expect(isArchiveBlockedHostname('::1')).toBe(true)
    expect(isAllowedArchiveUrl('https://localhost/a.zip')).toBe(false)
    expect(isAllowedArchiveUrl('https://127.0.0.1/a.zip')).toBe(false)
  })

  test('link-local and cloud metadata rejected', () => {
    expect(isArchiveBlockedHostname('169.254.169.254')).toBe(true)
    expect(isArchiveBlockedHostname('100.100.100.200')).toBe(true)
    expect(isArchiveBlockedHostname('fd00:ec2::254')).toBe(true)
    expect(
      isAllowedArchiveUrl('https://169.254.169.254/latest/meta-data'),
    ).toBe(false)
  })

  test('mapped IPv6 and fe80 link-local rejected (schema shares runtime policy)', () => {
    expect(isArchiveBlockedHostname('::ffff:127.0.0.1')).toBe(true)
    expect(isArchiveBlockedHostname('::ffff:7f00:1')).toBe(true)
    expect(isArchiveBlockedHostname('fe80::1')).toBe(true)
    expect(isAllowedArchiveUrl('https://[::ffff:127.0.0.1]/a.zip')).toBe(false)
    expect(isAllowedArchiveUrl('https://[fe80::1]/a.zip')).toBe(false)
    // schema refine reuses isAllowedArchiveUrl
    expect(
      PluginSourceSchema().safeParse({
        source: 'archive',
        url: 'https://[::ffff:169.254.169.254]/meta',
      }).success,
    ).toBe(false)
  })

  test('Mio gold message constant', () => {
    expect(ARCHIVE_URL_POLICY_MESSAGE).toBe(
      'Archive URLs must use https:// and must not point at a loopback, link-local, or cloud-metadata host',
    )
  })
})

describe('densable 2.1.224 #2 PluginSourceSchema archive', () => {
  test('accepts archive + optional sha256', () => {
    const r = PluginSourceSchema().safeParse({
      source: 'archive',
      url: VALID_URL,
      sha256: VALID_SHA,
    })
    expect(r.success).toBe(true)
  })

  test('accepts archive without sha256', () => {
    const r = PluginSourceSchema().safeParse({
      source: 'archive',
      url: VALID_URL,
    })
    expect(r.success).toBe(true)
  })

  test('rejects http archive url with Mio message', () => {
    const r = PluginSourceSchema().safeParse({
      source: 'archive',
      url: 'http://example.com/a.zip',
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      const msgs = r.error.issues.map(i => i.message).join(' ')
      expect(msgs).toContain(ARCHIVE_URL_POLICY_MESSAGE)
    }
  })

  test('rejects loopback archive url', () => {
    const r = PluginSourceSchema().safeParse({
      source: 'archive',
      url: 'https://127.0.0.1/a.zip',
    })
    expect(r.success).toBe(false)
  })

  test('rejects bad sha256 length', () => {
    const r = PluginSourceSchema().safeParse({
      source: 'archive',
      url: VALID_URL,
      sha256: 'abc',
    })
    expect(r.success).toBe(false)
  })
})

describe('densable 2.1.224 #2 calculatePluginVersion archive', () => {
  test('pinned sha256 → first 12 hex', async () => {
    const digest = 'abcdef0123456789' + '0'.repeat(48)
    const v = await calculatePluginVersion(
      'p@m',
      { source: 'archive', url: VALID_URL, sha256: digest },
      undefined,
      undefined,
      undefined,
    )
    expect(v).toBe('abcdef012345')
  })

  test('downloaded contentSha256 via gitCommitSha slot', async () => {
    const digest = 'fedcba9876543210' + '1'.repeat(48)
    const v = await calculatePluginVersion(
      'p@m',
      { source: 'archive', url: VALID_URL },
      undefined,
      undefined,
      undefined,
      digest,
    )
    expect(v).toBe('fedcba987654')
  })

  test('manifest version outranks archive digest', async () => {
    const digest = 'a'.repeat(64)
    const v = await calculatePluginVersion(
      'p@m',
      { source: 'archive', url: VALID_URL, sha256: digest },
      { name: 'p', description: 'd', version: '9.9.9' },
    )
    expect(v).toBe('9.9.9')
  })
})

describe('densable 2.1.224 #2 same-origin header gate', () => {
  test('same origin true; cross origin false', () => {
    expect(
      isSameOrigin(
        'https://market.example.com/m.json',
        'https://market.example.com/plugins/a.zip',
      ),
    ).toBe(true)
    expect(
      isSameOrigin(
        'https://market.example.com/m.json',
        'https://cdn.other.com/a.zip',
      ),
    ).toBe(false)
  })
})

describe('densable 2.1.224 #2 extract + wrapper promote', () => {
  let dir: string

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('hasPluginShapedRoot detects .claude-plugin', async () => {
    dir = await mkdtemp(join(tmpdir(), 'archive-shape-'))
    expect(await hasPluginShapedRoot(dir)).toBe(false)
    await mkdir(join(dir, '.claude-plugin'))
    await writeFile(
      join(dir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 't' }),
    )
    expect(await hasPluginShapedRoot(dir)).toBe(true)
  })

  test('promoteSingleWrapperDirectory strips one wrap dir', async () => {
    dir = await mkdtemp(join(tmpdir(), 'archive-wrap-'))
    const wrap = join(dir, 'my-plugin')
    await mkdir(join(wrap, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(wrap, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 't' }),
    )
    const promoted = await promoteSingleWrapperDirectory(dir)
    expect(promoted).toBe(wrap)
  })

  test('installPluginArchiveToDirectory extracts zip with wrapper', async () => {
    dir = await mkdtemp(join(tmpdir(), 'archive-install-'))
    const zipData = zipSync({
      'wrap-dir/.claude-plugin/plugin.json': Buffer.from(
        JSON.stringify({
          name: 'archive-demo',
          description: 'from zip',
          version: '1.0.0',
        }),
      ),
      'wrap-dir/commands/hi.md': Buffer.from('# hi'),
    })
    const target = join(dir, 'out')
    await installPluginArchiveToDirectory(
      Buffer.from(zipData),
      target,
      VALID_URL,
    )
    const manifest = await readFile(
      join(target, '.claude-plugin', 'plugin.json'),
      'utf-8',
    )
    expect(JSON.parse(manifest).name).toBe('archive-demo')
    expect(createHash('sha256').update(zipData).digest('hex')).toHaveLength(64)
  })

  test('empty zip rejected', async () => {
    dir = await mkdtemp(join(tmpdir(), 'archive-empty-'))
    const zipData = zipSync({
      '__MACOSX/._x': Buffer.from('x'),
    })
    await expect(
      installPluginArchiveToDirectory(
        Buffer.from(zipData),
        join(dir, 'out'),
        VALID_URL,
      ),
    ).rejects.toThrow(/contained no plugin files/)
  })
})
