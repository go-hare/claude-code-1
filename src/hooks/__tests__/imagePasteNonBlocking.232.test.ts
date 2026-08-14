/**
 * densable 2.1.232 #38 — clipboard / paste image read is non-blocking.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const pasteHandlerPath = join(import.meta.dir, '../usePasteHandler.ts')
const imagePastePath = join(import.meta.dir, '../../utils/imagePaste.ts')
const pasteSrc = readFileSync(pasteHandlerPath, 'utf8')
const imageSrc = readFileSync(imagePastePath, 'utf8')

describe('densable 2.1.232 #38 image paste non-blocking', () => {
  test('usePasteHandler fire-and-forgets getImageFromClipboard', () => {
    // densable: clipboard image path must not await on the key/paste hot path
    expect(pasteSrc).toContain('void getImageFromClipboard()')
    // must chain finishPaste in finally so pending clears after async settles
    expect(pasteSrc).toMatch(
      /void getImageFromClipboard\(\)[\s\S]*?\.finally\(\(\)\s*=>\s*\{[\s\S]*?finishPaste\(\)/,
    )
  })

  test('paste-pending safety ceiling is 30s (not a short hang that frees Enter early)', () => {
    expect(pasteSrc).toContain('PASTE_PENDING_SAFETY_MS = 30_000')
    expect(pasteSrc).toContain('markPastePending')
    // Safety timer clears pastePending so Enter cannot be swallowed forever
    expect(pasteSrc).toMatch(
      /setTimeout\(\(\)\s*=>\s*\{[\s\S]*?pastePendingRef\.current\s*=\s*false[\s\S]*?\},\s*PASTE_PENDING_SAFETY_MS\)/,
    )
  })

  test('native clipboard fast path gated by NATIVE_CLIPBOARD_IMAGE + kaleidoscope', () => {
    expect(imageSrc).toContain("feature('NATIVE_CLIPBOARD_IMAGE')")
    expect(imageSrc).toContain('tengu_collage_kaleidoscope')
    expect(imageSrc).toContain('readClipboardImage')
    // Authoritative null from native = no image (do not fall through to osascript)
    expect(imageSrc).toMatch(/if\s*\(\s*!native\s*\)\s*\{[\s\S]*?return null/)
  })
})
