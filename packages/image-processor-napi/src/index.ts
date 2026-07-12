import { existsSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
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
 * Candidate paths for the macOS clipboard-image helper.
 *
 * Layouts covered:
 * - bun compile: next to process.execPath / platform optionalDependency
 * - JS dist: dist/vendor/clipboard-image/arm64-darwin
 * - monorepo dev: vendor/clipboard-image/arm64-darwin
 */
function getClipboardBinaryCandidates(): string[] {
  const binaryName = `${process.arch}-${process.platform}`
  const rel = ['vendor', 'clipboard-image', binaryName] as const
  const execDir = dirname(process.execPath)
  const packageRoot = dirname(execDir)
  const packageParent = dirname(packageRoot)
  const platformPkg = `claude-code-${process.platform}-${process.arch}`

  const candidates = [
    join(execDir, ...rel),
    join(packageRoot, ...rel),
    join(packageRoot, 'node_modules', '@go-hare', platformPkg, ...rel),
    join(packageParent, platformPkg, ...rel),
    join(packageParent, '@go-hare', platformPkg, ...rel),
  ]

  try {
    const filePath = fileURLToPath(import.meta.url)
    const dir = dirname(filePath)
    const parts = dir.split(sep)
    const distIdx = parts.lastIndexOf('dist')
    if (distIdx !== -1) {
      candidates.push(join(parts.slice(0, distIdx + 1).join(sep), ...rel))
    }
    const packagesIdx = parts.lastIndexOf('packages')
    if (packagesIdx !== -1) {
      candidates.push(join(parts.slice(0, packagesIdx).join(sep), ...rel))
    }
  } catch {
    // import.meta.url may be unavailable in some embed layouts
  }

  candidates.push(join(process.cwd(), ...rel))
  return candidates
}

let resolvedBinaryPath: string | null | undefined

function resolveClipboardBinary(): string | null {
  if (resolvedBinaryPath !== undefined) return resolvedBinaryPath
  for (const candidate of getClipboardBinaryCandidates()) {
    if (existsSync(candidate)) {
      resolvedBinaryPath = candidate
      return candidate
    }
  }
  resolvedBinaryPath = null
  return null
}

function getClipboardPNG(): Buffer | null {
  if (process.platform !== 'darwin') return null

  const binaryPath = resolveClipboardBinary()
  if (!binaryPath) return null

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
  // Only expose the native path when the helper binary is actually present.
  // Otherwise imagePaste falls through to osascript.
  if (process.platform === 'darwin' && resolveClipboardBinary()) {
    return createDarwinNativeModule()
  }
  return null
}

export default sharp
