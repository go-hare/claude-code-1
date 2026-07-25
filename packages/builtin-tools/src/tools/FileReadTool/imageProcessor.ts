import type { Buffer } from 'buffer'
import { isInBundledMode } from 'src/utils/bundledMode.js'

export type SharpInstance = {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(
    width: number,
    height: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ): SharpInstance
  jpeg(options?: { quality?: number }): SharpInstance
  png(options?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): SharpInstance
  webp(options?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
}

export type SharpFunction = (input: Buffer) => SharpInstance

type SharpCreatorOptions = {
  create: {
    width: number
    height: number
    channels: 3 | 4
    background: { r: number; g: number; b: number }
  }
}

type SharpCreator = (options: SharpCreatorOptions) => SharpInstance

let imageProcessorModule: { default: SharpFunction } | null = null
let imageCreatorModule: { default: SharpCreator } | null = null

export async function getImageProcessor(): Promise<SharpFunction> {
  if (imageProcessorModule) {
    return imageProcessorModule.default
  }

  if (isInBundledMode()) {
    // Try to load the native image processor first
    try {
      // Use the native image processor module
      const imageProcessor = await import('image-processor-napi')
      // Bun/CJS interop can yield { sharp: { default: fn } } or { default: fn }.
      // Casting a non-function object caused: sharp2 is not a function (Object).
      const sharpFn = unwrapCallable<SharpFunction>(imageProcessor)
      imageProcessorModule = { default: sharpFn }
      return sharpFn
    } catch {
      // Fall back to sharp if native module is not available
      console.warn(
        'Native image processor not available, falling back to sharp',
      )
    }
  }

  // Use sharp for non-bundled builds or as fallback.
  // Single structural cast: our SharpFunction is a subset of sharp's actual type surface.
  const imported = await import('sharp')
  const sharp = unwrapCallable<SharpFunction>(imported)
  imageProcessorModule = { default: sharp }
  return sharp
}

/**
 * Get image creator for generating new images from scratch.
 * Note: image-processor-napi doesn't support image creation,
 * so this always uses sharp directly.
 */
export async function getImageCreator(): Promise<SharpCreator> {
  if (imageCreatorModule) {
    return imageCreatorModule.default
  }

  const imported = await import('sharp')
  const sharp = unwrapCallable<SharpCreator>(imported)
  imageCreatorModule = { default: sharp }
  return sharp
}

/**
 * Dynamic import shape varies by module interop:
 * - ESM: { default: fn }
 * - CJS: fn
 * - image-processor-napi: { sharp: fn } or nested { sharp: { default: fn } }
 * Walk default/sharp until a callable is found.
 * Exported for unit tests (Bun CJS interop regressions).
 */
export function unwrapCallable<T extends (...args: never[]) => unknown>(
  mod: unknown,
): T {
  let cur: unknown = mod
  for (let i = 0; i < 4; i++) {
    if (typeof cur === 'function') {
      return cur as T
    }
    if (!cur || typeof cur !== 'object') {
      break
    }
    const o = cur as Record<string, unknown>
    if (typeof o.default === 'function') {
      cur = o.default
      continue
    }
    if (typeof o.sharp === 'function') {
      cur = o.sharp
      continue
    }
    if (o.default && typeof o.default === 'object') {
      cur = o.default
      continue
    }
    if (o.sharp && typeof o.sharp === 'object') {
      cur = o.sharp
      continue
    }
    break
  }
  throw new Error('Image processor module export is not a function')
}
