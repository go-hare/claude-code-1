import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../../Tool.js'
import { generateFileAttachment } from '../attachments.js'

describe('attachments >256KB @-mention (#216)', () => {
  let tempDir: string
  let largeFile: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'attach-256kb-'))
    largeFile = join(tempDir, 'huge.txt')
    // >256KB (300KB)
    writeFileSync(largeFile, 'x'.repeat(300 * 1024), 'utf8')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('#216: generateFileAttachment returns at_mention_reference with unread=too_large and fileSize instead of null', async () => {
    const ctx = {
      getAppState: () => ({
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
      readFileState: new Map(),
      options: {},
    } as unknown as ToolUseContext

    const attachment = await generateFileAttachment(
      largeFile,
      ctx,
      'test_success',
      'test_error',
      'at-mention',
    )

    expect(attachment).not.toBeNull()
    expect(attachment).toMatchObject({
      type: 'at_mention_reference',
      mentions: [largeFile],
      unread: 'too_large',
      fileSize: 300 * 1024,
    })
  })
})
