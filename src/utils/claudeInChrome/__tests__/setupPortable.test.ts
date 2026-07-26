import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { detectExtensionInstallationPortable } from '../setupPortable.js'

const PROD_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function makeBrowserRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'chrome-ext-detect-'))
  tempRoots.push(root)
  return root
}

describe('detectExtensionInstallationPortable', () => {
  test('finds packed extension under Extensions/<id>', async () => {
    const root = await makeBrowserRoot()
    await mkdir(join(root, 'Default', 'Extensions', PROD_ID, '1.0.0'), {
      recursive: true,
    })

    const result = await detectExtensionInstallationPortable([
      { browser: 'chrome', path: root },
    ])
    expect(result.isInstalled).toBe(true)
    expect(result.browser).toBe('chrome')
  })

  test('finds unpacked extension via Secure Preferences path', async () => {
    const root = await makeBrowserRoot()
    const unpacked = await mkdtemp(join(tmpdir(), 'claude-unpacked-'))
    tempRoots.push(unpacked)
    await writeFile(join(unpacked, 'manifest.json'), '{"name":"Claude"}')

    const profile = join(root, 'Profile 1')
    await mkdir(profile, { recursive: true })
    await writeFile(
      join(profile, 'Secure Preferences'),
      JSON.stringify({
        extensions: {
          settings: {
            [PROD_ID]: {
              path: unpacked,
              location: 4,
              from_webstore: false,
              disable_reasons: [],
              has_started_service_worker: true,
            },
          },
        },
      }),
    )

    const result = await detectExtensionInstallationPortable([
      { browser: 'chrome', path: root },
    ])
    expect(result.isInstalled).toBe(true)
    expect(result.browser).toBe('chrome')
  })

  test('ignores prefs entry when unpacked path is missing', async () => {
    const root = await makeBrowserRoot()
    const profile = join(root, 'Default')
    await mkdir(profile, { recursive: true })
    await writeFile(
      join(profile, 'Secure Preferences'),
      JSON.stringify({
        extensions: {
          settings: {
            [PROD_ID]: {
              path: join(root, 'does-not-exist-unpacked'),
              location: 4,
              disable_reasons: [],
            },
          },
        },
      }),
    )

    const result = await detectExtensionInstallationPortable([
      { browser: 'chrome', path: root },
    ])
    expect(result.isInstalled).toBe(false)
  })

  test('ignores disabled extension in Preferences', async () => {
    const root = await makeBrowserRoot()
    const unpacked = await mkdtemp(join(tmpdir(), 'claude-disabled-'))
    tempRoots.push(unpacked)
    const profile = join(root, 'Default')
    await mkdir(profile, { recursive: true })
    await writeFile(
      join(profile, 'Preferences'),
      JSON.stringify({
        extensions: {
          settings: {
            [PROD_ID]: {
              path: unpacked,
              location: 4,
              state: 0,
              disable_reasons: [1],
            },
          },
        },
      }),
    )

    const result = await detectExtensionInstallationPortable([
      { browser: 'chrome', path: root },
    ])
    expect(result.isInstalled).toBe(false)
  })

  test('returns false when no profiles have the extension', async () => {
    const root = await makeBrowserRoot()
    await mkdir(join(root, 'Default', 'Extensions'), { recursive: true })

    const result = await detectExtensionInstallationPortable([
      { browser: 'chrome', path: root },
    ])
    expect(result.isInstalled).toBe(false)
    expect(result.browser).toBe(null)
  })
})
