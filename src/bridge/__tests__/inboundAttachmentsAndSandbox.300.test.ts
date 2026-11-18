import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  INBOUND_ATTACHMENT_MAX_BYTES,
  INBOUND_ATTACHMENT_UNVERIFIED_MAX_BYTES,
} from '../inboundAttachments.js'

describe('2.1.299/2.1.300 #656/#693/#694/#695/#820 bridge inboundAttachments & remote-control', () => {
  test('#695 unverified attachment cap is 35 MiB while sha256-verified remains 30 MiB', () => {
    expect(INBOUND_ATTACHMENT_MAX_BYTES).toBe(31_457_280)
    expect(INBOUND_ATTACHMENT_UNVERIFIED_MAX_BYTES).toBe(36_700_160)
  })

  test('#656/#693/#694 inboundAttachments retries stalled downloads, refreshes OAuth, and inlines images on write failure', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'inboundAttachments.ts'),
      'utf8',
    )
    expect(src).toContain('checkAndRefreshOAuthTokenIfNeeded')
    expect(src).toContain('DOWNLOAD_MAX_ATTEMPTS = 3')
    expect(src).toContain('isRetryableDownloadStatus')
    expect(src).toContain('wroteFile')
    expect(src).toContain('bufferToInlineImageBlock(data)')
  })

  test('#820 bridgeMain rejects --sandbox and --no-sandbox with removal message', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'bridgeMain.ts'),
      'utf8',
    )
    expect(src).toContain("arg === '--sandbox' || arg === '--no-sandbox'")
    expect(src).toContain(
      'is not supported by claude remote-control. The flag had no effect and was removed.',
    )
    expect(src).toContain(
      'To sandbox sessions, set sandbox.enabled to true in settings.',
    )
  })
})
