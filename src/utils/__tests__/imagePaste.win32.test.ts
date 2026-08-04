import { afterAll, describe, expect, test } from 'bun:test'
import { execa } from 'execa'
import { existsSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getImageFromClipboard,
  hasImageInClipboard,
  MIN_CLIPBOARD_IMAGE_EDGE,
} from '../imagePaste.js'

const isWin = process.platform === 'win32'

/** Minimal valid 1×1 PNG (should be rejected by MIN_CLIPBOARD_IMAGE_EDGE). */
function makeTinyPng1x1(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
}

/**
 * Solid 16×16 red PNG — large enough for provider min-dimension floors.
 * Precomputed offline; keep small for unit tests.
 */
function makePng16x16(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',
    'base64',
  )
}

async function putPngOnClipboard(pngPath: string): Promise<void> {
  const pathLit = pngPath.replace(/'/g, "''")
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    `$img = [System.Drawing.Image]::FromFile('${pathLit}')`,
    '[System.Windows.Forms.Clipboard]::SetImage($img)',
    '$img.Dispose()',
    'if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { exit 1 }',
    'exit 0',
  ].join('; ')
  const result = await execa(
    'powershell.exe',
    ['-NoProfile', '-STA', '-NonInteractive', '-Command', script],
    { shell: false, reject: false, windowsHide: true, timeout: 15_000 },
  )
  expect(result.exitCode).toBe(0)
}

describe('win32 clipboard image paste (LOCAL)', () => {
  test.skipIf(!isWin)(
    'getImageFromClipboard round-trips a real-size image without bash shell:true',
    async () => {
      const pngPath = join(tmpdir(), `claude-win-clip-src-${Date.now()}.png`)
      writeFileSync(pngPath, makePng16x16())
      try {
        await putPngOnClipboard(pngPath)
        expect(await hasImageInClipboard()).toBe(true)
        const image = await getImageFromClipboard()
        expect(image).not.toBeNull()
        expect(image!.base64.length).toBeGreaterThan(20)
        expect(image!.mediaType.startsWith('image/')).toBe(true)
        const w =
          image!.dimensions?.displayWidth ?? image!.dimensions?.originalWidth
        const h =
          image!.dimensions?.displayHeight ?? image!.dimensions?.originalHeight
        if (typeof w === 'number' && typeof h === 'number') {
          expect(w).toBeGreaterThanOrEqual(MIN_CLIPBOARD_IMAGE_EDGE)
          expect(h).toBeGreaterThanOrEqual(MIN_CLIPBOARD_IMAGE_EDGE)
        }
      } finally {
        if (existsSync(pngPath)) unlinkSync(pngPath)
      }
    },
    30_000,
  )

  test.skipIf(!isWin)(
    'rejects 1×1 clipboard images (provider min dimension floor)',
    async () => {
      const pngPath = join(tmpdir(), `claude-win-clip-1x1-${Date.now()}.png`)
      writeFileSync(pngPath, makeTinyPng1x1())
      try {
        await putPngOnClipboard(pngPath)
        // Clipboard has *an* image, but we must not ship it to the API.
        expect(await hasImageInClipboard()).toBe(true)
        const image = await getImageFromClipboard()
        expect(image).toBeNull()
      } finally {
        if (existsSync(pngPath)) unlinkSync(pngPath)
      }
    },
    30_000,
  )
})

afterAll(() => {
  // no-op: per-test cleanup
})
