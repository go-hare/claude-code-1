import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  applyPublishEdits,
  type ArtifactOutput,
  ArtifactTool,
  encodeWithOriginalBom,
  formatPublishEditsError,
  formatPublishEditsWritebackNote,
  validatePublishEdits,
} from '../ArtifactTool.js'

const TEST_DIR = join(tmpdir(), `artifact-publish-edits-test-${process.pid}`)
const HTML_FILE = join(TEST_DIR, 'page.html')
const originalFetch = globalThis.fetch

function mockUploadFetch(capturedBodies: string[]) {
  return mock((_url: string | URL | Request, init?: RequestInit) => {
    if (typeof init?.body === 'string') {
      capturedBodies.push(init.body)
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'art-1',
          url: 'https://example.test/7d/art-1.html',
          expiresAt: '2026-12-01T00:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  }) as unknown as typeof fetch
}

describe('ArtifactTool inline publish edits execution (#854)', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    process.env.CLAUDE_ARTIFACTS_TOKEN = 'test-token'
    process.env.CLAUDE_ARTIFACTS_URL = 'https://example.test'
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    delete process.env.CLAUDE_ARTIFACTS_TOKEN
    delete process.env.CLAUDE_ARTIFACTS_URL
    globalThis.fetch = originalFetch
  })

  test('validatePublishEdits & applyPublishEdits enforce sequential edits, CRLF, and error reasons', () => {
    expect(validatePublishEdits([{ old_str: '', new_str: 'x' }])).toEqual({
      reason: 'empty_old_str',
      edit: 0,
    })
    expect(validatePublishEdits([{ old_str: 'a', new_str: 'b\x00c' }])).toEqual(
      {
        reason: 'malformed',
        edit: 0,
      },
    )
    expect(
      validatePublishEdits([
        { old_str: 'a'.repeat(40000), new_str: 'b'.repeat(25537) },
      ]),
    ).toEqual({ reason: 'too_large' })

    // Sequential + CRLF preservation
    const crlfRes = applyPublishEdits('<h1>A</h1>\r\n<p>1</p>\r\n', [
      { old_str: '<h1>A</h1>', new_str: '<h1>B</h1>' },
      { old_str: '<h1>B</h1>\n<p>1</p>', new_str: '<h1>B</h1>\n<p>2</p>' },
    ])
    expect(crlfRes).toEqual({ ok: true, content: '<h1>B</h1>\r\n<p>2</p>\r\n' })

    // not_found & ambiguous & noop & json_invalid
    expect(
      applyPublishEdits('hello world', [{ old_str: 'xyz', new_str: 'abc' }]),
    ).toEqual({
      ok: false,
      reason: 'not_found',
      edit: 0,
    })
    expect(
      applyPublishEdits('dup dup dup', [{ old_str: 'dup', new_str: 'one' }]),
    ).toEqual({ ok: false, reason: 'ambiguous', edit: 0, count: 3 })
    expect(
      applyPublishEdits('same', [{ old_str: 'same', new_str: 'same' }]),
    ).toEqual({ ok: false, reason: 'noop' })
    expect(
      applyPublishEdits('{"a":1}', [{ old_str: '1', new_str: 'broken,' }], {
        json: true,
      }),
    ).toEqual({ ok: false, reason: 'json_invalid' })
  })

  test('formatPublishEditsError includes file body only when within maxChars and reason is not_found/ambiguous', () => {
    const edits = [{ old_str: 'missing', new_str: 'x' }]
    const withBody = formatPublishEditsError(
      { reason: 'not_found', edit: 0 },
      edits,
      '<h1>Current</h1>',
      500,
    )
    expect(withBody).toContain("The file's current text follows")
    expect(withBody).toContain('<h1>Current</h1>')

    const tooLong = formatPublishEditsError(
      { reason: 'not_found', edit: 0 },
      edits,
      '<h1>Current</h1>',
      50,
    )
    expect(tooLong).toContain('The file is too long to show here')
    expect(tooLong).not.toContain('<h1>Current</h1>')

    const noopMsg = formatPublishEditsError(
      { reason: 'noop' },
      edits,
      '<h1>Current</h1>',
      500,
    )
    expect(noopMsg).not.toContain("The file's current text follows")
  })

  test('encodeWithOriginalBom preserves UTF-8 BOM and UTF-16LE BOM', () => {
    const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf, 0x61])
    expect([...encodeWithOriginalBom(utf8Bom, 'hi')]).toEqual([
      0xef, 0xbb, 0xbf, 0x68, 0x69,
    ])
    const utf16Le = Buffer.from([0xff, 0xfe, 0x61, 0x00])
    expect([...encodeWithOriginalBom(utf16Le, 'hi')]).toEqual([
      0xff, 0xfe, 0x68, 0x00, 0x69, 0x00,
    ])
  })

  test('formatPublishEditsWritebackNote matches gold Pia copy', () => {
    expect(formatPublishEditsWritebackNote(1, 'page')).toBe(
      'The edit was written to the file after it was published, so the file matches the published page.',
    )
    expect(formatPublishEditsWritebackNote(2, 'page')).toBe(
      'The 2 edits were written to the file after it was published, so the file matches the published page.',
    )
    expect(
      formatPublishEditsWritebackNote(1, 'page', 'not_writable'),
    ).toContain(
      'it could not be opened for writing (read-only), so it was left as it is',
    )
    expect(formatPublishEditsWritebackNote(2, 'page', 'hard_linked')).toContain(
      'and publish it without `edits` while it has other names',
    )
    expect(
      formatPublishEditsWritebackNote(1, 'page', 'write_failed'),
    ).toContain('writing it back failed, and the file may be partly written')
  })

  test('ArtifactTool.call applies edits before upload, writes back preserving BOM, and updates readFileState', async () => {
    const origWithBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('<h1>Old</h1><p>Body</p>', 'utf8'),
    ])
    writeFileSync(HTML_FILE, origWithBom)
    const capturedBodies: string[] = []
    globalThis.fetch = mockUploadFetch(capturedBodies)

    const cache = new Map<
      string,
      {
        content: string
        timestamp: number
        offset?: number
        limit?: number
        contentNotInModelContext?: boolean
      }
    >()
    cache.set(HTML_FILE, {
      content: '<h1>Old</h1><p>Body</p>',
      timestamp: 0,
      offset: undefined,
      limit: undefined,
    })

    const res = await ArtifactTool.call(
      {
        file_path: HTML_FILE,
        edits: [
          { old_str: '<h1>Old</h1>', new_str: '<h1>New</h1>' },
          { old_str: '<p>Body</p>', new_str: '<p>Updated</p>' },
        ],
      } as never,
      { readFileState: cache as never },
    )

    const data = res.data as ArtifactOutput
    expect(data.error).toBeUndefined()
    expect(data.editsApplied).toBe(2)
    expect(data.editsNotWritten).toBeUndefined()
    expect(capturedBodies).toHaveLength(1)
    expect(capturedBodies[0]).toBe('<h1>New</h1><p>Updated</p>')

    const diskBytes = readFileSync(HTML_FILE)
    expect([...diskBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(diskBytes.subarray(3).toString('utf8')).toBe(
      '<h1>New</h1><p>Updated</p>',
    )
    expect(cache.get(HTML_FILE)?.content).toBe('<h1>New</h1><p>Updated</p>')

    const block = ArtifactTool.mapToolResultToToolResultBlockParam!(
      data,
      'tu-1',
    )
    expect(String(block.content)).toContain(
      'The 2 edits were written to the file after it was published, so the file matches the published page.',
    )
  })

  test('ArtifactTool.call aborts publish and leaves disk untouched when an edit does not match', async () => {
    writeFileSync(HTML_FILE, '<h1>Keep</h1>', 'utf8')
    const capturedBodies: string[] = []
    globalThis.fetch = mockUploadFetch(capturedBodies)

    const res = await ArtifactTool.call({
      file_path: HTML_FILE,
      edits: [{ old_str: '<h1>Missing</h1>', new_str: '<h1>New</h1>' }],
    } as never)

    expect(capturedBodies).toHaveLength(0)
    expect(res.data.error).toContain(
      'No edits were applied and nothing was published',
    )
    expect(res.data.error).toContain(
      'edits[0] old_str does not occur in the file',
    )
    expect(readFileSync(HTML_FILE, 'utf8')).toBe('<h1>Keep</h1>')
  })

  test('ArtifactTool.call reports hard_linked when disk file has nlink > 1 after upload', async () => {
    writeFileSync(HTML_FILE, '<h1>Old</h1>', 'utf8')
    linkSync(HTML_FILE, join(TEST_DIR, 'page-hardlink.html'))
    const capturedBodies: string[] = []
    globalThis.fetch = mockUploadFetch(capturedBodies)

    const res = await ArtifactTool.call({
      file_path: HTML_FILE,
      edits: [{ old_str: '<h1>Old</h1>', new_str: '<h1>New</h1>' }],
    } as never)

    const data = res.data as ArtifactOutput
    expect(capturedBodies).toHaveLength(1)
    expect(data.editsApplied).toBe(1)
    expect(data.editsNotWritten).toBe('hard_linked')
    expect(readFileSync(HTML_FILE, 'utf8')).toBe('<h1>Old</h1>')

    const block = ArtifactTool.mapToolResultToToolResultBlockParam!(
      data,
      'tu-2',
    )
    expect(String(block.content)).toContain(
      'it has other names on disk (a hard link)',
    )
  })

  test('ArtifactTool.call reports not_writable when file is read-only', async () => {
    writeFileSync(HTML_FILE, '<h1>Old</h1>', 'utf8')
    chmodSync(HTML_FILE, 0o444)
    const capturedBodies: string[] = []
    globalThis.fetch = mockUploadFetch(capturedBodies)

    try {
      const res = await ArtifactTool.call({
        file_path: HTML_FILE,
        edits: [{ old_str: '<h1>Old</h1>', new_str: '<h1>New</h1>' }],
      } as never)

      const data = res.data as ArtifactOutput
      expect(capturedBodies).toHaveLength(1)
      expect(data.editsApplied).toBe(1)
      expect(data.editsNotWritten).toBe('not_writable')
      expect(readFileSync(HTML_FILE, 'utf8')).toBe('<h1>Old</h1>')
    } finally {
      chmodSync(HTML_FILE, 0o644)
    }
  })
})
