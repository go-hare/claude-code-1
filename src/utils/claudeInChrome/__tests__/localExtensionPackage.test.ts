import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  isValidUnpackedExtensionDir,
  normalizeZipRoot,
  resolveLocalChromeExtensionPackageDir,
} from '../localExtensionPackage.js'

const created: string[] = []

afterEach(async () => {
  delete process.env.CLAUDE_CHROME_LOCAL_EXTENSION_DIR
  await Promise.all(
    created.splice(0).map(p => rm(p, { recursive: true, force: true })),
  )
})

describe('isValidUnpackedExtensionDir', () => {
  test('true when manifest.json exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chrome-ext-pkg-'))
    created.push(dir)
    await writeFile(join(dir, 'manifest.json'), '{}')
    expect(isValidUnpackedExtensionDir(dir)).toBe(true)
  })

  test('false without manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chrome-ext-empty-'))
    created.push(dir)
    expect(isValidUnpackedExtensionDir(dir)).toBe(false)
  })
})

describe('resolveLocalChromeExtensionPackageDir', () => {
  test('honors CLAUDE_CHROME_LOCAL_EXTENSION_DIR', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chrome-ext-env-'))
    created.push(dir)
    await writeFile(join(dir, 'manifest.json'), '{"name":"Claude"}')
    process.env.CLAUDE_CHROME_LOCAL_EXTENSION_DIR = dir
    expect(resolveLocalChromeExtensionPackageDir()).toBe(dir)
  })

  test('returns null for env path without manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chrome-ext-bad-'))
    created.push(dir)
    process.env.CLAUDE_CHROME_LOCAL_EXTENSION_DIR = dir
    expect(resolveLocalChromeExtensionPackageDir()).toBe(null)
  })
})

describe('normalizeZipRoot', () => {
  test('strips single top-level folder', () => {
    const files = {
      'claude_1.0.81/manifest.json': new Uint8Array([1]),
      'claude_1.0.81/bg.js': new Uint8Array([2]),
    }
    const out = normalizeZipRoot(files)
    expect(out['manifest.json']).toBeDefined()
    expect(out['bg.js']).toBeDefined()
    expect(out['claude_1.0.81/manifest.json']).toBeUndefined()
  })

  test('keeps flat zip as-is', () => {
    const files = {
      'manifest.json': new Uint8Array([1]),
      'bg.js': new Uint8Array([2]),
    }
    const out = normalizeZipRoot(files)
    expect(out['manifest.json']).toBeDefined()
    expect(out['bg.js']).toBeDefined()
  })

  test('ignores __MACOSX junk then strips package folder', () => {
    const files = {
      '__MACOSX/._claude_1.0.81': new Uint8Array([9]),
      '__MACOSX/claude_1.0.81/._manifest.json': new Uint8Array([9]),
      'claude_1.0.81/manifest.json': new Uint8Array([1]),
      'claude_1.0.81/bg.js': new Uint8Array([2]),
      'claude_1.0.81/.DS_Store': new Uint8Array([3]),
    }
    const out = normalizeZipRoot(files)
    expect(out['manifest.json']).toBeDefined()
    expect(out['bg.js']).toBeDefined()
    expect(Object.keys(out).some(k => k.includes('__MACOSX'))).toBe(false)
    expect(out['.DS_Store']).toBeUndefined()
  })
})
