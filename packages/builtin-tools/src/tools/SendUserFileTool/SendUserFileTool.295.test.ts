import { describe, expect, test } from 'bun:test'
import {
  formatLargeFileUploadFailure,
  SUSPECTED_UPLOAD_LIMIT_BYTES,
} from '../BriefTool/upload.js'
import { SendUserFileTool } from './SendUserFileTool.js'
import { ArtifactTool } from '../ArtifactTool/ArtifactTool.js'

describe('#453 SendUserFileTool & BriefTool/upload large-file failure messaging', () => {
  test('formatLargeFileUploadFailure tells Claude to report failure instead of shrinking for >30 MiB unnamed errors', () => {
    const msg = formatLargeFileUploadFailure({
      size: SUSPECTED_UPLOAD_LIMIT_BYTES + 1024,
      uploadError: 'upload failed: server returned 502',
      suspectedLimitBytes: SUSPECTED_UPLOAD_LIMIT_BYTES,
    })
    expect(msg).toContain('the cause is unknown and may pass')
    expect(msg).toContain('never under 30 MiB')
    expect(msg).toContain('instead of shrinking the file')
  })

  test('SendUserFileTool.mapToolResultToToolResultBlockParam includes detailed error when sent=false', () => {
    const block = SendUserFileTool.mapToolResultToToolResultBlockParam!(
      {
        sent: false,
        file_path: '/tmp/big.bin',
        error:
          'upload failed: server returned 504 — Report this failure to the user instead of shrinking the file.',
      } as never,
      'tu-1',
    )
    expect(block.content).toContain('Failed to send file /tmp/big.bin:')
    expect(block.content).toContain('instead of shrinking the file')
  })
})

describe('#259 ArtifactTool listing total & limit 200 formatting', () => {
  test('mapToolResultToToolResultBlockParam formats total and hidden count when total > artifacts.length', () => {
    const block = ArtifactTool.mapToolResultToToolResultBlockParam!(
      {
        id: '',
        url: '',
        expiresAt: '',
        artifacts: [{ title: 'A', url: 'https://claude.ai/artifact/a' }],
        total: 75,
      } as never,
      'tu-2',
    )
    expect(block.content).toContain('Listed 1 of 75 published artifact(s)')
    expect(block.content).toContain('74 more not shown')
    expect(block.content).toContain('up to 200')
  })
})
