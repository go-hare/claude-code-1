/**
 * densable b5 / MLe / joe (2.1.289): default artifact out_dir lives in the
 * session scratchpad; no scratchpad → cwd; scratchpad saves create it 0o700.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as realFilesystem from 'src/utils/permissions/filesystem.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

const filesystemSnap = snapshotModuleExports(realFilesystem)
const root = mkdtempSync(join(tmpdir(), 'artifact-out-289-'))
const scratchpad = join(root, 'session', 'scratchpad')
let scratchOn = true

mock.module('src/utils/permissions/filesystem.js', () => ({
  ...filesystemSnap,
  isScratchpadEnabled: () => scratchOn,
  getScratchpadDir: () => scratchpad,
}))

const {
  defaultArtifactFilesDir,
  isInArtifactScratchpad,
  resolveAssetOutStem,
  resolveFileOutDest,
  writeBytesExclusive,
} = await import('src/services/artifactAutoReact/outDirPaths.js')
const { isArtifactToolRegistered } = await import('src/utils/artifactUrl.js')
const { getCwd } = await import('src/utils/cwd.js')

afterAll(() => {
  mock.module('src/utils/permissions/filesystem.js', () => ({
    ...filesystemSnap,
  }))
  rmSync(root, { recursive: true, force: true })
})

const SLUG = '11111111-1111-1111-1111-111111111111'
const URL = `https://claude.ai/code/artifact/${SLUG}`
const ASSET_ID = 'b'.repeat(32)

describe('b5 default out_dir (289)', () => {
  test('scratchpad on → <scratchpad>/artifact-files/<slug>', () => {
    scratchOn = true
    const dir = join(scratchpad, 'artifact-files', SLUG)
    expect(defaultArtifactFilesDir(SLUG)).toBe(dir)
    expect(resolveAssetOutStem({ url: URL, asset_id: ASSET_ID })).toBe(
      join(dir, ASSET_ID),
    )
    expect(resolveFileOutDest({ url: URL, path: 'docs/a.md' })).toEqual({
      dest: join(dir, 'docs', 'a.md'),
      base: dir,
      defaultDir: true,
    })
  })

  test('no scratchpad → null, saves fall back to cwd (not a shared tmp dir)', () => {
    scratchOn = false
    expect(isArtifactToolRegistered()).toBe(false)
    expect(defaultArtifactFilesDir(SLUG)).toBeNull()
    expect(resolveAssetOutStem({ url: URL, asset_id: ASSET_ID })).toBe(
      join(getCwd(), ASSET_ID),
    )
    scratchOn = true
  })

  test('MLe matches only paths inside the scratchpad', () => {
    scratchOn = true
    expect(
      isInArtifactScratchpad(join(scratchpad, 'artifact-files', 'x')),
    ).toBe(true)
    expect(isInArtifactScratchpad(scratchpad)).toBe(false)
    expect(isInArtifactScratchpad(join(root, 'elsewhere'))).toBe(false)
    expect(isInArtifactScratchpad(join(scratchpad, '..', '..', 'escape'))).toBe(
      false,
    )
  })

  test('joe — saving into the scratchpad creates it owner-only (0o700)', async () => {
    scratchOn = true
    const dest = join(defaultArtifactFilesDir(SLUG) ?? '', 'a.bin')
    await writeBytesExclusive(dest, Buffer.from('hi'))
    expect(readFileSync(dest, 'utf8')).toBe('hi')
    expect(statSync(scratchpad).mode & 0o777).toBe(0o700)
  })
})
