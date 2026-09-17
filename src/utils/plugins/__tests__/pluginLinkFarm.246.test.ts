/**
 * densable 2.1.246 #18 — official AFe/BLn link-farm helpers.
 * 09-16 promoted to HAVE. VFS GG/T0o main path inlined;
 * canServeSymlinkedVersionPath = versionPathIsTrustedForServe && versionDirHasPluginShapeMarkers && kq; FLn=Ut official list.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import {
  COMMAND_PLUGIN_LINK_MARKER,
  hasCommandPluginLinkFarm,
  relinkCommandPluginLinkFarm,
} from '../pluginCommandSource.js'

const tempDirs: string[] = []

afterEach(async () => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()
    if (d) await rm(d, { recursive: true, force: true }).catch(() => {})
  }
})

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return await realpath(dir)
}

describe('#18 AFe/BLn link-farm (2.1.246)', () => {
  test('AFe is true only for a parseable small marker', async () => {
    const dest = await scratch('link-afe-')
    expect(await hasCommandPluginLinkFarm(dest)).toBe(false)
    await writeFile(
      join(dest, COMMAND_PLUGIN_LINK_MARKER),
      JSON.stringify({ target: dest }),
    )
    expect(await hasCommandPluginLinkFarm(dest)).toBe(true)
    await writeFile(join(dest, COMMAND_PLUGIN_LINK_MARKER), 'not-json')
    expect(await hasCommandPluginLinkFarm(dest)).toBe(false)
  })

  test.skipIf(process.platform === 'win32')(
    'BLn relinks top-level symlinks via linking-pid then rename',
    async () => {
      const root = await scratch('link-bln-')
      const producer = join(root, 'producer')
      const src = join(root, 'farm')
      const dest = join(root, 'versioned')
      await mkdir(join(producer, '.claude-plugin'), { recursive: true })
      await writeFile(join(producer, '.claude-plugin', 'plugin.json'), '{}')
      await mkdir(src)
      await symlink(
        join(producer, '.claude-plugin'),
        join(src, '.claude-plugin'),
        'dir',
      )
      await writeFile(
        join(src, COMMAND_PLUGIN_LINK_MARKER),
        JSON.stringify({ target: producer }),
        { flag: 'wx' },
      )

      await relinkCommandPluginLinkFarm(src, dest)

      expect(await hasCommandPluginLinkFarm(dest)).toBe(true)
      const marker = JSON.parse(
        await readFile(join(dest, COMMAND_PLUGIN_LINK_MARKER), 'utf8'),
      ) as { target: string }
      expect(marker.target).toBe(producer)
      expect(await realpath(join(dest, '.claude-plugin'))).toBe(
        await realpath(join(producer, '.claude-plugin')),
      )
    },
  )
})
