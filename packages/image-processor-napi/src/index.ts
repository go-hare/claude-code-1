import { join } from 'node:path'
import sharpModule from 'sharp'

export const sharp = sharpModule

interface NativeModule {
  hasClipboardImage(): boolean
  readClipboardImage(
    maxWidth?: number,
    maxHeight?: number,
  ): {
    png: Buffer
    width: number
    height: number
    originalWidth: number
    originalHeight: number
  } | null
}

/**
 * Resolve the path to the clipboard-image binary.
 * In dev: vendor/clipboard-image/arm64-darwin
 * In dist: dist/vendor/clipboard-image/arm64-darwin
 */
function getClipboardBinaryPath(): string {
  const url = import.meta.url
  const idx = url.lastIndexOf('dist')
  if (idx !== -1) {
    const root = url.slice(0, idx + 4).replace('file://', '')
    return join(root, 'vendor', 'clipboard-image', 'arm64-darwin')
  }
  const srcIdx = url.lastIndexOf('packages')
  if (srcIdx !== -1) {
    const root = url.slice(0, srcIdx).replace('file://', '')
    return join(root, 'vendor', 'clipboard-image', 'arm64-darwin')
  }
  return join(process.cwd(), 'vendor', 'clipboard-image', 'arm64-darwin')
}

let binaryPath: string | null = null

function getClipboardPNG(): Buffer | null {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return null

  if (!binaryPath) {
    binaryPath = getClipboardBinaryPath()
  }

  try {
    const result = Bun.spawnSync({
      cmd: [binaryPath],
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (result.exitCode !== 0) return null
    const buf = Buffer.from(result.stdout)
    if (buf.length === 0) return null
    return buf
  } catch {
    return null
  }
}

function createDarwinNativeModule(): NativeModule {
  return {
    hasClipboardImage(): boolean {
      const data = getClipboardPNG()
      return data !== null
    },

    readClipboardImage(maxWidth?: number, maxHeight?: number) {
      const buffer = getClipboardPNG()
      if (!buffer || buffer.length === 0) return null

      // Output is always PNG (Swift binary converts TIFF→PNG)
      let width = 0
      let height = 0
      if (
        buffer.length > 24 &&
        buffer[12] === 0x49 &&
        buffer[13] === 0x48 &&
        buffer[14] === 0x44 &&
        buffer[15] === 0x52
      ) {
        width = buffer.readUInt32BE(16)
        height = buffer.readUInt32BE(20)
      }

      const originalWidth = width
      const originalHeight = height

      if (maxWidth && maxHeight) {
        if (width > maxWidth || height > maxHeight) {
          const scale = Math.min(maxWidth / width, maxHeight / height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
      }

      return { png: buffer, width, height, originalWidth, originalHeight }
    },
  }
}

export function getNativeModule(): NativeModule | null {
  if (process.platform === 'darwin') {
    return createDarwinNativeModule()
  }
  return null
}

export default sharp
