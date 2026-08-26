/**
 * densable 2.1.239 #36 — G() + CXq `.git/config.worktree` denyWrite.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { getPlatform } from '../../platform.js'
import { ensureLinuxGitWorktreeConfigPlaceholder } from '../sandbox-adapter.js'

describe('densable 2.1.239 #36 config.worktree', () => {
  test('adapter CXq lists config.worktree next to config', async () => {
    const src = await Bun.file(
      new URL('../sandbox-adapter.ts', import.meta.url),
    ).text()
    expect(src).toContain("join(projectGitDir, 'config.lock')")
    expect(src).toContain("join(projectGitDir, 'config.worktree.lock')")
    expect(src).toContain("join(projectGitDir, 'commondir')")
    expect(src).toContain("openSync(path, 'wx')")
  })

  test('G() materializes missing file only on linux/wsl', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cc-wtcfg-'))
    try {
      const path = join(dir, 'config.worktree')
      ensureLinuxGitWorktreeConfigPlaceholder(path)
      const plat = getPlatform()
      if (plat === 'linux' || plat === 'wsl') {
        expect(existsSync(path)).toBe(true)
      } else {
        expect(existsSync(path)).toBe(false)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('G() no-ops when parent is not a directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cc-wtcfg-'))
    try {
      const parentFile = join(dir, 'not-a-dir')
      writeFileSync(parentFile, '')
      ensureLinuxGitWorktreeConfigPlaceholder(
        join(parentFile, 'config.worktree'),
      )
      expect(existsSync(join(parentFile, 'config.worktree'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('G() does not replace an existing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cc-wtcfg-'))
    try {
      mkdirSync(join(dir, 'nested'))
      const path = join(dir, 'nested', 'config.worktree')
      writeFileSync(path, 'keep')
      ensureLinuxGitWorktreeConfigPlaceholder(path)
      expect(await Bun.file(path).text()).toBe('keep')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
