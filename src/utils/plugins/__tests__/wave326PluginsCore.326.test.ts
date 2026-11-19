/**
 * Wave 326 Group 5B — Plugins core & Mods alignment tests:
 * #5, #326, #10, #98, #99, #123, #329, #330.
 */
import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { zipSync, strToU8 } from 'fflate'
import {
  checkPluginHandoverBeforeSend,
  inspectPluginHandoverArchive,
} from '../../../plugins/bundled/pluginAuthoring.js'
import { formatPluginWarningForDisplay } from '../../../commands/plugin/PluginErrors.js'
import {
  PLUGIN_PROXY_CONNECT_TIMEOUT_MS,
  applyPluginProxyConnectTimeout,
  getPluginDownloadProxyOptions,
} from '../fetchTelemetry.js'
import {
  UI_BOX_OVERFLOW_X_VALUES,
  UI_TEXT_WRAP_VALUES,
  normalizeModScrollXTree,
  normalizeModTextWrapAndMaxLines,
  uiRenderModPropsCheck,
  validateModBoxOverflowX,
  validateModTextMaxLines,
  validateModTextWrap,
} from '../functionHooksModules.js'
import { removePluginMcpbCache } from '../mcpbHandler.js'
import {
  IGNORABLE_MANIFEST_DISPLAY_FIELDS,
  MANIFEST_FIELD_IGNORED_HINT,
  formatManifestFieldIgnoredMessage,
  loadPluginManifestWithDiagnostics,
  parsePluginManifestLenient,
} from '../pluginLoader.js'
import {
  buildSkippedWorktreePluginSettingsNotice,
  isWorktreeProjectSettingsPath,
} from '../worktreePluginSettings.js'

const FAKE_ANTHROPIC_KEY = `sk-ant-api03-${'A'.repeat(48)}`

describe('2.1.326 #5 & #326 — lenient plugin.json display fields + manifest-field-ignored', () => {
  test('ignores malformed author/homepage and loads plugin with manifest-field-ignored', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'g5b-manifest-'))
    try {
      const manifestPath = join(dir, 'plugin.json')
      await writeFile(
        manifestPath,
        JSON.stringify({
          name: 'demo-plugin',
          version: '1.0.0',
          author: 'not-an-object',
          homepage: 12345,
        }),
        'utf8',
      )

      const res = await loadPluginManifestWithDiagnostics(
        manifestPath,
        'demo-plugin',
        'demo-plugin@mp',
      )
      expect(res.manifest.name).toBe('demo-plugin')
      expect(res.ignoredFields).toEqual(['author', 'homepage'])

      const msg = formatManifestFieldIgnoredMessage(res.ignoredFields)
      expect(msg).toBe(
        '"author" and "homepage" in plugin.json are malformed and ignored. Earlier versions of Claude Code refused this plugin',
      )

      const displayed = formatPluginWarningForDisplay({
        type: 'manifest-field-ignored',
        source: 'demo-plugin@mp',
        plugin: 'demo-plugin',
        manifestFields: res.ignoredFields,
        warning: msg,
      })
      expect(displayed.message).toBe(msg)
      expect(displayed.guidance).toBe(MANIFEST_FIELD_IGNORED_HINT)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('strict validation (refusesDisplayFaults: true) still rejects malformed display fields', () => {
    const strict = parsePluginManifestLenient(
      { name: 'demo', author: 'bad-author' },
      { refusesDisplayFaults: true },
    )
    expect(strict.ok).toBe(false)
    expect(IGNORABLE_MANIFEST_DISPLAY_FIELDS.has('author')).toBe(true)
    expect(IGNORABLE_MANIFEST_DISPLAY_FIELDS.has('homepage')).toBe(true)
  })

  test('non-display structural errors still fail lenient parsing', () => {
    const bad = parsePluginManifestLenient({
      name: 42,
      author: 'bad-author',
    })
    expect(bad.ok).toBe(false)
  })
})

describe('2.1.326 #10 — mod Box overflowX="scroll", Text maxLines & wrap="clip"', () => {
  test('validates overflowX, wrap="clip", and maxLines bounds', () => {
    expect(UI_BOX_OVERFLOW_X_VALUES.has('scroll')).toBe(true)
    expect(validateModBoxOverflowX('scroll')).toBeUndefined()
    expect(validateModBoxOverflowX('auto')).toContain('must be one of')

    expect(UI_TEXT_WRAP_VALUES.has('clip')).toBe(true)
    expect(validateModTextWrap('clip')).toBeUndefined()
    expect(validateModTextWrap('bogus')).toContain('must be one of')

    expect(validateModTextMaxLines(1)).toBeUndefined()
    expect(validateModTextMaxLines(10_000)).toBeUndefined()
    expect(validateModTextMaxLines(0)).toContain('whole number from 1 to 10000')
    expect(validateModTextMaxLines(1.5)).toContain('whole number')
  })

  test('normalizes maxLines + wrap precedence and overflowX="scroll" subtree', () => {
    expect(
      normalizeModTextWrapAndMaxLines({ maxLines: 3, wrap: 'wrap' }),
    ).toEqual({ maxLines: 3 })
    expect(
      normalizeModTextWrapAndMaxLines({ maxLines: 3, wrap: 'clip' }),
    ).toEqual({ wrap: 'clip' })

    const normalized = normalizeModScrollXTree<{
      type: string
      props: Record<string, unknown>
      children: unknown[]
    }>({
      type: 'Box',
      props: { overflowX: 'scroll' },
      children: [
        'plain-string',
        {
          type: 'Text',
          props: { maxLines: 2, wrap: 'wrap' },
          children: ['hi'],
        },
      ],
    })
    expect(normalized.props).toMatchObject({
      overflowX: 'scroll',
      flexWrap: 'nowrap',
      minWidth: 0,
    })
    expect(normalized.children[0]).toEqual({
      type: 'Text',
      props: { wrap: 'truncate-end' },
      children: ['plain-string'],
    })
    expect(normalized.children[1]).toEqual({
      type: 'Text',
      props: { wrap: 'truncate-end' },
      children: ['hi'],
    })
  })

  test('#10 review fix: uiRenderModPropsCheck validates Box.overflowX, Text.wrap, and Text.maxLines across live trees and PluginRasterPanes wires normalizers', async () => {
    expect(
      uiRenderModPropsCheck({
        type: 'Box',
        props: { overflowX: 'scroll' },
        children: [
          {
            type: 'Text',
            props: { wrap: 'clip', maxLines: 3 },
            children: ['ok'],
          },
        ],
      }),
    ).toBeUndefined()

    expect(
      uiRenderModPropsCheck({
        type: 'Box',
        props: { overflowX: 'auto' },
        children: [],
      }),
    ).toContain('Box prop "overflowX" must be one of')

    expect(
      uiRenderModPropsCheck({
        type: 'Box',
        props: {},
        children: [
          { type: 'Text', props: { wrap: 'invalid' }, children: ['x'] },
        ],
      }),
    ).toContain('Text prop "wrap" must be one of')

    expect(
      uiRenderModPropsCheck({
        type: 'Box',
        props: {},
        children: [{ type: 'Text', props: { maxLines: 0 }, children: ['x'] }],
      }),
    ).toContain('Text prop "maxLines" must be a whole number')

    const panesSrc = await Bun.file(
      new URL('../../../components/PluginRasterPanes.tsx', import.meta.url),
    ).text()
    expect(panesSrc).toContain('normalizeModScrollXTree(rawNode)')
    expect(panesSrc).toContain('normalizeModTextWrapAndMaxLines(')
  })
})

describe('2.1.326 #98 & #99 — pluginAuthoring Send it reliability + nested zip/OOXML scan', () => {
  test('#99: clean nested .docx inside .plugin is scanned and passes as clean', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'g5b-handover-'))
    try {
      const cleanDocx = zipSync({
        'word/document.xml': strToU8('<w:document>Hello team</w:document>'),
      })
      const pluginArchive = zipSync({
        '.claude-plugin/plugin.json': strToU8('{"name":"doc-plugin"}'),
        'templates/brief.docx': cleanDocx,
      })
      const pluginPath = join(dir, 'doc-plugin.plugin')
      await writeFile(pluginPath, pluginArchive)

      const res = await inspectPluginHandoverArchive(pluginPath)
      expect(res.kind).toBe('clean')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#99: secret inside nested .docx is detected and reported with nested path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'g5b-handover-secret-'))
    try {
      const secretDocx = zipSync({
        'word/document.xml': strToU8(
          `<w:document>key=${FAKE_ANTHROPIC_KEY}</w:document>`,
        ),
      })
      const pluginArchive = zipSync({
        '.claude-plugin/plugin.json': strToU8('{"name":"leak-plugin"}'),
        'templates/secret.docx': secretDocx,
      })
      const pluginPath = join(dir, 'leak-plugin.plugin')
      await writeFile(pluginPath, pluginArchive)

      const res = await inspectPluginHandoverArchive(pluginPath)
      expect(res.kind).toBe('ask')
      if (res.kind === 'ask') {
        expect(res.question).toContain(
          'word/document.xml in templates/secret.docx',
        )
        expect(res.question).toContain('Anthropic Key')
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#98: choosing "Send it" succeeds even if file mtime is restamped while user decides', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'g5b-handover-restamp-'))
    try {
      const pluginArchive = zipSync({
        '.claude-plugin/plugin.json': strToU8('{"name":"key-plugin"}'),
        'config.txt': strToU8(`token=${FAKE_ANTHROPIC_KEY}`),
      })
      const pluginPath = join(dir, 'key-plugin.plugin')
      await writeFile(pluginPath, pluginArchive)

      const refusal = await checkPluginHandoverBeforeSend([pluginPath], {
        askUser: async () => {
          // Simulate sandbox/Cowork restamping mtime without modifying bytes
          const st = await stat(pluginPath)
          const later = new Date(st.mtimeMs + 5000)
          await utimes(pluginPath, later, later)
          return { kind: 'chose', value: 'send' }
        },
      })
      expect(refusal).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('#98: choosing "Send it" still refuses if file contents actually change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'g5b-handover-tamper-'))
    try {
      const pluginArchive = zipSync({
        '.claude-plugin/plugin.json': strToU8('{"name":"key-plugin"}'),
        'config.txt': strToU8(`token=${FAKE_ANTHROPIC_KEY}`),
      })
      const pluginPath = join(dir, 'key-plugin.plugin')
      await writeFile(pluginPath, pluginArchive)

      const refusal = await checkPluginHandoverBeforeSend([pluginPath], {
        askUser: async () => {
          const modified = zipSync({
            '.claude-plugin/plugin.json': strToU8('{"name":"key-plugin"}'),
            'config.txt': strToU8(`token=${FAKE_ANTHROPIC_KEY}-extra`),
          })
          await writeFile(pluginPath, modified)
          return { kind: 'chose', value: 'send' }
        },
      })
      expect(refusal).toContain('changed while the person was being asked')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('2.1.326 #123 — ALL_PROXY HttpsProxyAgent 25s timeout', () => {
  test('sets 25s timeout when ALL_PROXY is the only proxy env var', () => {
    expect(PLUGIN_PROXY_CONNECT_TIMEOUT_MS).toBe(25_000)
    const opts = getPluginDownloadProxyOptions(
      'https://github.com/anthropics/claude-plugins-official',
      { ALL_PROXY: 'http://127.0.0.1:8888' },
    )
    expect(opts.proxy).toBe(false)
    expect(opts.httpsAgent).toBeDefined()
    expect(opts.proxyTimeoutMs).toBe(25_000)
  })

  test('applyPluginProxyConnectTimeout aborts hung connect with ETIMEDOUT', async () => {
    const opts = getPluginDownloadProxyOptions(
      'https://example.com/archive.zip',
      { ALL_PROXY: 'http://127.0.0.1:9999' },
      30,
    )
    const agent = opts.httpsAgent!
    // Replace underlying connect on a fresh agent to simulate a never-answering proxy
    const fakeAgent = {
      connectOpts: {},
      connect: async () =>
        new Promise((_resolve, reject) => {
          const sig = (fakeAgent.connectOpts as { signal?: AbortSignal }).signal
          sig?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    }
    applyPluginProxyConnectTimeout(fakeAgent as unknown as typeof agent, 25)
    let caught: (Error & { code?: string }) | undefined
    try {
      await (
        fakeAgent as unknown as {
          connect: (req: unknown, o: unknown) => Promise<unknown>
        }
      ).connect({}, { host: 'example.com', port: 443 })
    } catch (err) {
      caught = err as Error & { code?: string }
    }
    expect(caught?.code).toBe('ETIMEDOUT')
    expect(caught?.message).toContain('Timed out connecting through the proxy')
  })

  test('#123 review fix: concurrent applyPluginProxyConnectTimeout calls do not clobber shared connectOpts.signal', async () => {
    const seenSignals: Array<AbortSignal | undefined> = []
    const fakeAgent = {
      connectOpts: { host: '127.0.0.1', port: 9999 } as Record<string, unknown>,
      connect: async (
        _req: unknown,
        opts: {
          host: string
          port: number
          signal?: AbortSignal
          hang?: boolean
        },
      ) => {
        const sigFromOpts = opts.signal
        const sigFromConnectOpts = fakeAgent.connectOpts.signal as
          | AbortSignal
          | undefined
        expect(sigFromOpts).toBe(sigFromConnectOpts)
        seenSignals.push(sigFromOpts)
        if (opts.hang) {
          return await new Promise((_resolve, reject) => {
            sigFromOpts?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            )
          })
        }
        await new Promise(r => setTimeout(r, 40))
        expect(sigFromOpts?.aborted).toBe(false)
        return 'ok-socket'
      },
    }
    applyPluginProxyConnectTimeout(
      fakeAgent as unknown as Parameters<
        typeof applyPluginProxyConnectTimeout
      >[0],
      60,
    )
    const connect = (
      fakeAgent as unknown as {
        connect: (req: unknown, o: unknown) => Promise<unknown>
      }
    ).connect

    // Start hanging request first, then fast request concurrently
    const p1 = connect({}, { host: 'a.example.com', port: 443, hang: true })
    // Shared connectOpts.signal must be restored immediately after sync start
    expect(fakeAgent.connectOpts.signal).toBeUndefined()
    const p2 = connect({}, { host: 'b.example.com', port: 443, hang: false })
    expect(fakeAgent.connectOpts.signal).toBeUndefined()

    const [r1, r2] = await Promise.allSettled([p1, p2])
    expect(r1.status).toBe('rejected')
    expect((r1 as PromiseRejectedResult).reason?.code).toBe('ETIMEDOUT')
    expect(r2.status).toBe('fulfilled')
    expect((r2 as PromiseFulfilledResult<unknown>).value).toBe('ok-socket')
    expect(seenSignals[0]).not.toBe(seenSignals[1])
    expect(fakeAgent.connectOpts.signal).toBeUndefined()
  })
})

describe('2.1.326 #329 — mcpb-cache cleanup on plugin uninstall', () => {
  test('deletes unreferenced bundle dirs and preserves bundles shared by another plugin', async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), 'g5b-mcpb-cache-'))
    try {
      const bucketA = join(cacheRoot, 'bucket-a')
      const soloExtracted = join(bucketA, 'hash-solo')
      const sharedExtracted = join(bucketA, 'hash-shared')
      await mkdir(soloExtracted, { recursive: true })
      await mkdir(sharedExtracted, { recursive: true })
      await writeFile(join(soloExtracted, 'manifest.json'), '{}', 'utf8')
      await writeFile(join(sharedExtracted, 'manifest.json'), '{}', 'utf8')

      const soloMetaPath = join(bucketA, '11111111.metadata.json')
      const sharedMetaPath = join(bucketA, '22222222.metadata.json')
      await writeFile(
        soloMetaPath,
        JSON.stringify({
          source: './solo.mcpb',
          contentHash: 'hash-solo',
          extractedPath: soloExtracted,
          cachedAt: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          pluginIds: ['plugin-a@mp'],
        }),
        'utf8',
      )
      await writeFile(
        sharedMetaPath,
        JSON.stringify({
          source: './shared.mcpb',
          contentHash: 'hash-shared',
          extractedPath: sharedExtracted,
          cachedAt: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          pluginIds: ['plugin-a@mp', 'plugin-b@mp'],
        }),
        'utf8',
      )

      const cleanup = await removePluginMcpbCache('plugin-a@mp', cacheRoot)
      expect(cleanup.removedDirs).toContain(soloExtracted)
      expect(cleanup.removedMetadata).toContain(soloMetaPath)
      expect(cleanup.removedDirs).not.toContain(sharedExtracted)

      const soloExists = await stat(soloExtracted).then(
        () => true,
        () => false,
      )
      const sharedExists = await stat(sharedExtracted).then(
        () => true,
        () => false,
      )
      expect(soloExists).toBe(false)
      expect(sharedExists).toBe(true)

      const updatedSharedMeta = JSON.parse(
        await Bun.file(sharedMetaPath).text(),
      ) as { pluginIds: string[] }
      expect(updatedSharedMeta.pluginIds).toEqual(['plugin-b@mp'])
    } finally {
      await rm(cacheRoot, { recursive: true, force: true })
    }
  })

  test('#329 review fix: uninstalling pluginA removes <bucketA>/<contentHash> even when pluginB uses <bucketB>/<contentHash>', async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), 'g5b-mcpb-cross-bucket-'))
    try {
      const bucketA = join(cacheRoot, 'bucket-a')
      const bucketB = join(cacheRoot, 'bucket-b')
      const extractedA = join(bucketA, 'same-hash')
      const extractedB = join(bucketB, 'same-hash')
      await mkdir(extractedA, { recursive: true })
      await mkdir(extractedB, { recursive: true })
      await writeFile(join(extractedA, 'manifest.json'), '{}', 'utf8')
      await writeFile(join(extractedB, 'manifest.json'), '{}', 'utf8')

      await writeFile(
        join(bucketA, 'aaaa.metadata.json'),
        JSON.stringify({
          source: './a.mcpb',
          contentHash: 'same-hash',
          extractedPath: extractedA,
          cachedAt: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          pluginIds: ['plugin-a@mp'],
        }),
        'utf8',
      )
      await writeFile(
        join(bucketB, 'bbbb.metadata.json'),
        JSON.stringify({
          source: './b.mcpb',
          contentHash: 'same-hash',
          extractedPath: extractedB,
          cachedAt: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          pluginIds: ['plugin-b@mp'],
        }),
        'utf8',
      )

      const cleanup = await removePluginMcpbCache('plugin-a@mp', cacheRoot)
      expect(cleanup.removedDirs).toContain(extractedA)
      expect(cleanup.keptSharedDirs).not.toContain(extractedA)
      expect(
        await stat(extractedA).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
      expect(
        await stat(extractedB).then(
          () => true,
          () => false,
        ),
      ).toBe(true)
    } finally {
      await rm(cacheRoot, { recursive: true, force: true })
    }
  })
})

describe('2.1.326 #330 — worktree sessions skip repo plugin settings + notice', () => {
  test('detects .claude/worktrees/ project settings path and formats single/multi notices', () => {
    expect(
      isWorktreeProjectSettingsPath(
        '/repo/.claude/worktrees/wt-1/.claude/settings.json',
      ),
    ).toBe(true)

    const single = buildSkippedWorktreePluginSettingsNotice({
      isSkipping: true,
      initialExtraMarketplaces: { 'team-tools': { source: 'github' } },
      declaredMarketplaces: {},
      knownMarketplaces: {},
    })
    expect(single.skippedMarketplaces).toEqual(['team-tools'])
    expect(single.notice).toBe(
      'Skipped marketplace "team-tools". If main has it, run Claude there once.',
    )

    const multi = buildSkippedWorktreePluginSettingsNotice({
      isSkipping: true,
      initialExtraMarketplaces: { m1: {}, m2: {} },
      declaredMarketplaces: {},
      knownMarketplaces: {},
    })
    expect(multi.notice).toBe(
      'Skipped 2 marketplaces. If main has them, run Claude there once.',
    )

    const alreadyKnown = buildSkippedWorktreePluginSettingsNotice({
      isSkipping: true,
      initialExtraMarketplaces: { 'team-tools': {} },
      declaredMarketplaces: {},
      knownMarketplaces: { 'team-tools': {} },
    })
    expect(alreadyKnown.notice).toBeNull()
  })

  test('#330 review fix: worktreePluginSettings.ts has no static ESM import of ../worktree.js', async () => {
    const src = await Bun.file(
      new URL('../worktreePluginSettings.ts', import.meta.url),
    ).text()
    expect(src).not.toMatch(/^\s*import\s+.*from\s+['"]\.\.\/worktree\.js['"]/m)
  })
})
