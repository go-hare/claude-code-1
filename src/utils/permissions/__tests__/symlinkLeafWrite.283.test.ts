/**
 * densable `pct` @179663773 — permission-layer symlink-leaf deny on Write/Edit.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileWriteTool } from '@claude-code/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import { FileEditTool } from '@claude-code/builtin-tools/tools/FileEditTool/FileEditTool.js'
import {
  checkWritePermissionForTool,
  denySymlinkLeafWrite,
} from '../filesystem.js'
import type { ToolPermissionContext } from 'src/Tool.js'

function baseCtx(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
    ...overrides,
  } as ToolPermissionContext
}

describe('densable pct symlink-leaf write deny', () => {
  const roots: string[] = []
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('plain file is not a pct deny', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pct-plain-'))
    roots.push(root)
    const file = join(root, 'plain.txt')
    await writeFile(file, 'x')
    expect(denySymlinkLeafWrite(file)).toBeNull()
  })

  test('symlink leaf deny includes landing and blockedPath', async () => {
    if (process.platform === 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'pct-link-'))
    roots.push(root)
    const real = join(root, 'real.txt')
    await writeFile(real, 'x')
    const link = join(root, 'leaf-link.txt')
    await symlink(real, link)
    const deny = denySymlinkLeafWrite(link)
    expect(deny?.behavior).toBe('deny')
    expect(deny?.message).toContain('it is a symbolic link')
    const landing = await realpath(link)
    expect(deny?.message).toContain(landing)
    expect(deny?.blockedPath).toBe(landing)
    expect(deny?.decisionReason).toEqual({
      type: 'other',
      reason: 'Write target is a symbolic link',
    })
  })

  test('checkWritePermissionForTool denies a symlink leaf even with Edit allow', async () => {
    if (process.platform === 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'pct-allow-'))
    roots.push(root)
    await mkdir(root, { recursive: true })
    const real = join(root, 'real.txt')
    await writeFile(real, 'x')
    const link = join(root, 'leaf-link.txt')
    await symlink(real, link)
    const result = checkWritePermissionForTool(
      FileWriteTool,
      { file_path: link, content: 'hijack' },
      baseCtx({
        alwaysAllowRules: { session: ['Write', 'Edit'] },
      }),
    )
    expect(result.behavior).toBe('deny')
    if (result.behavior === 'deny') {
      expect(result.message).toContain('symbolic link')
      expect(result.blockedPath).toBe(await realpath(link))
    }
    const edit = checkWritePermissionForTool(
      FileEditTool,
      { file_path: link, old_string: 'x', new_string: 'y' },
      baseCtx({
        alwaysAllowRules: { session: ['Edit'] },
      }),
    )
    expect(edit.behavior).toBe('deny')
  })
})
