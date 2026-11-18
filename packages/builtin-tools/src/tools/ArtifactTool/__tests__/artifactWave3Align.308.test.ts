import { createHash } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, test } from 'bun:test'
import {
  ArtifactTool,
  classifyConflictResendUiMessage,
  formatCheckedConflictPrompt,
  formatConflictMergePrompt,
  formatSameTurnConflictPrompt,
  formatUnviewedResendRefusal,
  PUBLISH_REFUSED_PREFIX,
} from '../ArtifactTool.js'
import { inputSchema } from '../artifactInputSchemas.js'
import { renderToolResultMessage } from '../UI.js'
import {
  diffPublishPathPins,
  formatPathPinConflictUiMessage,
  formatPathPinRefusalMessage,
  pinArtifactPath,
  recordPublishedPathPins,
  resetArtifactAutoReactStoreForTests,
  un,
  unpinArtifactPath,
} from 'src/services/artifactAutoReact/store.js'

describe('Wave 3 #906 ArtifactTool optimistic-concurrency retry-prompt distinction', () => {
  test('distinguishes en/tn (needs merge) vs rn (checked, retry should succeed) for both content and edits', () => {
    for (const forced of [false, true]) {
      const enContent = formatConflictMergePrompt('v3', forced, false)
      expect(enContent.startsWith(PUBLISH_REFUSED_PREFIX)).toBe(true)
      expect(classifyConflictResendUiMessage(enContent)).toBe(
        'Not published: Claude sent the same content again after a newer version of the artifact turned it away. Claude needs to work from that newer version first.',
      )

      const tnContent = formatSameTurnConflictPrompt('v3', forced, false)
      expect(classifyConflictResendUiMessage(tnContent)).toBe(
        'Not published: Claude sent the same content again after a newer version of the artifact turned it away. Claude needs to work from that newer version first.',
      )

      const rnContent = formatCheckedConflictPrompt(
        'v3',
        undefined,
        forced,
        false,
      )
      expect(classifyConflictResendUiMessage(rnContent)).toBe(
        "Not published: Claude sent the same content again after a newer version of the artifact turned it away. The artifact hasn't changed since, so publishing it once more should go through.",
      )

      const enEdits = formatConflictMergePrompt('v3', forced, true)
      expect(classifyConflictResendUiMessage(enEdits)).toBe(
        'Not published: Claude sent its changes again over the same file after a newer version of the artifact turned them away. Claude needs to work from that newer version first.',
      )

      const rnEdits = formatCheckedConflictPrompt('v3', undefined, forced, true)
      expect(classifyConflictResendUiMessage(rnEdits)).toBe(
        "Not published: Claude sent its changes again over the same file after a newer version of the artifact turned them away. The artifact hasn't changed since, so publishing it once more should go through.",
      )
    }

    expect(formatUnviewedResendRefusal('v4', false)).toContain(
      'newer version v4 still does not count as viewed',
    )
    expect(formatUnviewedResendRefusal('v4', true)).toContain(
      'no edits applied; your file was already refused against that version',
    )
  })

  test('UI renderToolResultMessage renders concise conflict summary when not verbose', () => {
    const err = formatCheckedConflictPrompt('v5', undefined, false, false)
    const node = renderToolResultMessage(
      { id: '', url: '', expiresAt: '', error: err },
      [],
      { verbose: false },
    )
    expect(JSON.stringify(node)).toContain(
      "The artifact hasn't changed since, so publishing it once more should go through.",
    )
  })
})

describe('Wave 3 #1152 ArtifactTool pathPins, overwrite_unread, and force schema', () => {
  beforeEach(() => {
    resetArtifactAutoReactStoreForTests()
  })

  test('inputSchema accepts force: boolean and overwrite_unread: string[]', () => {
    const parsed = inputSchema().safeParse({
      url: 'https://claude.ai/artifact/abc',
      file_path: '/tmp/index.html',
      force: true,
      overwrite_unread: ['styles.css', 'app.js'],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.force).toBe(true)
      expect(parsed.data.overwrite_unread).toEqual(['styles.css', 'app.js'])
    }
  })

  test('pathPins tracks read/list/publish/unpin and diffPublishPathPins distinguishes changed vs unread', () => {
    pinArtifactPath('slug-1', 'index.html', 'sha-1', 'v1', 'read')
    pinArtifactPath('slug-1', 'old.js', 'sha-old', 'v1', 'list')
    unpinArtifactPath('slug-1', 'old.js')
    recordPublishedPathPins('slug-1', 'v2', {
      written: [{ path: 'app.js', sha256: 'sha-app-v2' }],
      removed: ['gone.txt'],
    })

    const pins = un().pathPins.get('slug-1')
    expect(pins?.has('old.js')).toBe(false)
    expect(pins?.get('app.js')?.via).toBe('publish')
    expect(pins?.get('gone.txt')?.sha256).toBeNull()

    const live = new Map<string, string | null>([
      ['index.html', 'sha-2'], // changed since read
      ['unread.css', 'sha-css'], // unread
      ['ack.css', 'sha-ack'], // acknowledged via overwrite_unread
    ])
    const conflicts = diffPublishPathPins({
      pins,
      live,
      writes: [
        { path: 'index.html', sha256: 'sha-new' },
        { path: 'unread.css', sha256: 'sha-new-css' },
        { path: 'ack.css', sha256: 'sha-new-ack' },
      ],
      removes: [],
      acknowledged: new Set(['ack.css']),
    })

    expect(conflicts.map(c => [c.path, c.kind])).toEqual([
      ['index.html', 'changed'],
      ['unread.css', 'unread'],
    ])

    const refusal = formatPathPinRefusalMessage(conflicts, 'v3', {
      files: new Map([
        ['index.html', { sha256: 'sha-2', sizeBytes: 42 }],
        ['unread.css', { sha256: 'sha-css', sizeBytes: 10 }],
      ]),
      forced: true,
    })
    expect(refusal).toContain('`force` does not override this.')
    expect(refusal).toContain('`overwrite_unread`')
    expect(formatPathPinConflictUiMessage(refusal)).toBe(
      'Not published: some files on the artifact changed since Claude last saw them, and others Claude has not read yet. Claude needs to read the latest versions before publishing again.',
    )
  })

  test('ArtifactTool.call live callUpload enforces refusedPublishBodies resend prompts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'artifact-resend-'))
    const filePath = join(dir, 'index.html')
    const html = '<html><body>hello</body></html>'
    writeFileSync(filePath, html)
    const bodySha256 = createHash('sha256').update(html, 'utf8').digest('hex')
    const slug = '11111111-1111-1111-1111-111111111111'
    const url = `https://claude.ai/artifact/${slug}`

    try {
      // 1. Unviewed resend refusal
      un().refusedPublishBodies.set(slug, {
        sha256: bodySha256,
        live: 'v2',
        unviewed: true,
      })
      const unviewedRes = await ArtifactTool.call(
        { file_path: filePath, url },
        {} as never,
      )
      expect(unviewedRes.data.error).toBe(
        formatUnviewedResendRefusal('v2', false),
      )

      // 2. Same-turn conflict prompt
      un().refusedPublishBodies.set(slug, {
        sha256: bodySha256,
        live: 'v3',
        observedFrom: 'main',
      })
      const sameTurnRes = await ArtifactTool.call(
        { file_path: filePath, url },
        {} as never,
      )
      expect(sameTurnRes.data.error).toBe(
        formatSameTurnConflictPrompt('v3', false, false),
      )

      // 3. Checked conflict prompt (read pin at live version, forceRefused)
      pinArtifactPath(slug, 'index.html', 'other-sha', 'v4', 'read')
      un().refusedPublishBodies.set(slug, {
        sha256: bodySha256,
        live: 'v4',
        forceRefused: true,
      })
      const checkedRes = await ArtifactTool.call(
        { file_path: filePath, url, force: true },
        {} as never,
      )
      expect(checkedRes.data.error).toBe(
        formatCheckedConflictPrompt('v4', undefined, true, false),
      )

      // 4. Default merge conflict prompt
      un().refusedPublishBodies.set(slug, {
        sha256: bodySha256,
        live: 'v5',
      })
      const mergeRes = await ArtifactTool.call(
        { file_path: filePath, url },
        {} as never,
      )
      expect(mergeRes.data.error).toBe(
        formatConflictMergePrompt('v5', false, false),
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
