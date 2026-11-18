import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  checkPathSafetyForAutoEdit,
  isPathUnderDevModsRoot,
} from './filesystem.js'

describe('permissions Wave 4A (#586)', () => {
  const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
  const tempDirs: string[] = []

  afterEach(() => {
    if (prevConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#586 blocks auto-edit into session dev-mods even when CLAUDE_CONFIG_DIR has no .claude segment', () => {
    const customConfigDir = mkdtempSync(join(tmpdir(), 'custom-cfg-'))
    tempDirs.push(customConfigDir)
    process.env.CLAUDE_CONFIG_DIR = customConfigDir

    const modFile = join(customConfigDir, 'dev-mods', 'sess-1', 'evil.ts')
    expect(isPathUnderDevModsRoot(modFile)).toBe(true)

    const safety = checkPathSafetyForAutoEdit(modFile)
    expect(safety.safe).toBe(false)
  })

  test('#586 detects symlinked paths under dev-mods root', () => {
    const customConfigDir = mkdtempSync(join(tmpdir(), 'custom-cfg-sym-'))
    const targetDir = mkdtempSync(join(tmpdir(), 'sym-target-'))
    tempDirs.push(customConfigDir, targetDir)
    process.env.CLAUDE_CONFIG_DIR = customConfigDir

    const devModsDir = join(customConfigDir, 'dev-mods')
    mkdirSync(devModsDir, { recursive: true })
    symlinkSync(targetDir, join(devModsDir, 'linked-mod'))
    const linkedFile = join(targetDir, 'index.ts')
    writeFileSync(linkedFile, 'export default () => {}\n', 'utf8')

    expect(isPathUnderDevModsRoot(linkedFile)).toBe(true)
  })
})
