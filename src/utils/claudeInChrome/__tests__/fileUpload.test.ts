import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile, symlink, link } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { debugMock } from '../../../../tests/mocks/debug.js'
import { logMock } from '../../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/utils/debug.js', debugMock)
mock.module('src/utils/log.js', logMock)

// Isolate session id for uploads dir
const TEST_SESSION = 'chrome-fileupload-test-session'
mock.module('../../bootstrap/state.js', () => ({
  getSessionId: () => TEST_SESSION,
  getOriginalCwd: () => process.cwd(),
  getCwd: () => process.cwd(),
}))

import { getEmptyToolPermissionContext } from '../../../Tool.js'
import {
  assertChromeUploadPath,
  chromeFileUploadDeniedMessage,
  clearChromeUploadAttachmentDigestsForTests,
  getChromeSessionUploadsDir,
  prepareChromeFileUploadInput,
  registerChromeUploadAttachmentDigest,
  sha256Hex,
} from '../fileUpload.js'

describe('prepareChromeFileUploadInput / assertChromeUploadPath (Host Uiy)', () => {
  let workDir: string
  let allowedFile: string
  let outsideFile: string

  beforeEach(async () => {
    clearChromeUploadAttachmentDigestsForTests()
    workDir = await mkdtemp(join(tmpdir(), 'chrome-upload-'))
    allowedFile = join(workDir, 'allowed.txt')
    await writeFile(allowedFile, 'hello-upload')
    outsideFile = join(tmpdir(), `chrome-upload-outside-${Date.now()}.txt`)
    await writeFile(outsideFile, 'secret')
  })

  afterEach(() => {
    clearChromeUploadAttachmentDigestsForTests()
  })

  function permWithCwd(cwd = workDir) {
    // pathInAllowedWorkingPath uses allWorkingDirectories which includes getCwd();
    // override via additionalWorkingDirectories + mode default.
    const base = getEmptyToolPermissionContext()
    return {
      ...base,
      additionalWorkingDirectories: new Map([
        [cwd, { path: cwd, source: 'session' as const }],
      ]),
    }
  }

  test('allows file under additional working directory', async () => {
    const result = await prepareChromeFileUploadInput(
      'file_upload',
      { paths: [allowedFile], ref: 'r1', tabId: 1 },
      permWithCwd(workDir),
    )
    expect('error' in result).toBe(false)
    if ('input' in result) {
      expect(Array.isArray(result.input.files)).toBe(true)
      const files = result.input.files as Array<{ data: string; name: string }>
      expect(files[0].name).toBe('allowed.txt')
      expect(Buffer.from(files[0].data, 'base64').toString()).toBe(
        'hello-upload',
      )
      expect(result.input.paths).toBeUndefined()
    }
  })

  test('denies path outside working dirs with Med message', async () => {
    const result = await prepareChromeFileUploadInput(
      'file_upload',
      { paths: [outsideFile], ref: 'r1', tabId: 1 },
      permWithCwd(workDir),
    )
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe(chromeFileUploadDeniedMessage(outsideFile))
      expect(result.error).toContain('/add-dir')
    }
  })

  test('allows session uploads dir without working-dir membership', async () => {
    const uploads = getChromeSessionUploadsDir()
    await mkdir(uploads, { recursive: true })
    const att = join(uploads, 'abcd1234-report.pdf')
    const body = Buffer.from('%PDF-fake')
    await writeFile(att, body)
    registerChromeUploadAttachmentDigest(att, sha256Hex(body))

    const base = getEmptyToolPermissionContext()
    // No additional dirs; only attachments root should allow.
    const result = await prepareChromeFileUploadInput(
      'file_upload',
      { paths: [att], ref: 'r1', tabId: 1 },
      base,
    )
    expect('error' in result).toBe(false)
    if ('input' in result) {
      const files = result.input.files as Array<{ name: string }>
      expect(files[0].name).toBe('report.pdf')
    }
  })

  test('rejects digest mismatch on registered attachment', async () => {
    const uploads = getChromeSessionUploadsDir()
    await mkdir(uploads, { recursive: true })
    const att = join(uploads, 'zzzz9999-doc.txt')
    await writeFile(att, 'original')
    registerChromeUploadAttachmentDigest(att, sha256Hex('other-content'))

    const result = await prepareChromeFileUploadInput(
      'file_upload',
      { paths: [att], ref: 'r1', tabId: 1 },
      getEmptyToolPermissionContext(),
    )
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toBe(chromeFileUploadDeniedMessage(att))
    }
  })

  test('bypassPermissions allows outside path', async () => {
    const base = getEmptyToolPermissionContext()
    const result = await prepareChromeFileUploadInput(
      'file_upload',
      { paths: [outsideFile], ref: 'r1', tabId: 1 },
      { ...base, mode: 'bypassPermissions' },
    )
    expect('error' in result).toBe(false)
  })

  test('rejects hardlink', async () => {
    const hl = join(workDir, 'hardlink.txt')
    await link(allowedFile, hl)
    const result = await prepareChromeFileUploadInput(
      'file_upload',
      { paths: [hl], ref: 'r1', tabId: 1 },
      permWithCwd(workDir),
    )
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('hard link')
    }
  })

  test('whole-tool Read deny blocks non-root paths', async () => {
    const base = getEmptyToolPermissionContext()
    await expect(
      assertChromeUploadPath(allowedFile, {
        ...base,
        additionalWorkingDirectories: new Map([
          [workDir, { path: workDir, source: 'session' as const }],
        ]),
        alwaysDenyRules: { session: ['Read'] },
      }),
    ).rejects.toThrow(/Read tool is restricted/)
  })

  test('browser_batch rewrites nested file_upload and shares budget', async () => {
    const result = await prepareChromeFileUploadInput(
      'browser_batch',
      {
        actions: [
          { name: 'navigate', input: { url: 'https://example.com' } },
          {
            name: 'file_upload',
            input: { paths: [allowedFile], ref: 'r1', tabId: 1 },
          },
        ],
      },
      permWithCwd(workDir),
    )
    expect('error' in result).toBe(false)
    if ('input' in result) {
      const actions = result.input.actions as Array<{
        name: string
        input: { files?: unknown[]; paths?: unknown }
      }>
      expect(actions[0].name).toBe('navigate')
      expect(actions[1].input.files).toBeDefined()
      expect(actions[1].input.paths).toBeUndefined()
    }
  })

  test('empty paths rejected', async () => {
    const result = await prepareChromeFileUploadInput(
      'file_upload',
      { paths: [], ref: 'r1', tabId: 1 },
      permWithCwd(workDir),
    )
    expect('error' in result).toBe(true)
  })

  test('rejects top-level files without paths (no Uiy skip)', async () => {
    const result = await prepareChromeFileUploadInput(
      'file_upload',
      {
        files: [
          {
            name: 'x.txt',
            mimeType: 'text/plain',
            data: Buffer.from('sneak').toString('base64'),
          },
        ],
        ref: 'r1',
        tabId: 1,
      },
      permWithCwd(workDir),
    )
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('paths')
      expect(result.error).toMatch(
        /Do not pass pre-encoded `files`|non-empty `paths`/,
      )
    }
  })

  test('rejects browser_batch file_upload with only files', async () => {
    const result = await prepareChromeFileUploadInput(
      'browser_batch',
      {
        actions: [
          {
            name: 'file_upload',
            input: {
              files: [
                {
                  name: 'y.txt',
                  mimeType: 'text/plain',
                  data: Buffer.from('sneak').toString('base64'),
                },
              ],
              ref: 'r1',
              tabId: 1,
            },
          },
        ],
      },
      permWithCwd(workDir),
    )
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('paths')
    }
  })

  test('rejects browser_batch BRIDGE_ONLY tools (Host package parity)', async () => {
    for (const name of [
      'switch_browser',
      'list_connected_browsers',
      'select_browser',
    ]) {
      const result = await prepareChromeFileUploadInput(
        'browser_batch',
        { actions: [{ name, input: {} }] },
        permWithCwd(workDir),
      )
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.error).toContain(name)
        expect(result.error).toMatch(/top-level only|not batchable/)
      }
    }
  })

  test('rejects nested browser_batch and malformed sub-actions', async () => {
    const nested = await prepareChromeFileUploadInput(
      'browser_batch',
      { actions: [{ name: 'browser_batch', input: { actions: [] } }] },
      permWithCwd(workDir),
    )
    expect('error' in nested).toBe(true)
    if ('error' in nested) {
      expect(nested.error).toMatch(/cannot be nested|string name/)
    }

    const bad = await prepareChromeFileUploadInput(
      'browser_batch',
      { actions: ['navigate'] },
      permWithCwd(workDir),
    )
    expect('error' in bad).toBe(true)

    const cased = await prepareChromeFileUploadInput(
      'browser_batch',
      {
        actions: [
          {
            name: 'File_Upload',
            input: { paths: [allowedFile], ref: 'r1', tabId: 1 },
          },
        ],
      },
      permWithCwd(workDir),
    )
    expect('error' in cased).toBe(true)
    if ('error' in cased) {
      expect(cased.error).toContain('not a valid tool name')
    }
  })
})
