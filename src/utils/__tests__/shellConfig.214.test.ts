/**
 * densable 2.1.214 #36 — shell-config path is a directory must soft-skip
 * (update/doctor hang, /status blank). densable mnn Tae + cMs unreadable skip.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  findClaudeAlias,
  getShellConfigPaths,
  readFileLines,
} from '../shellConfig.js'

describe('densable #36 shell-config isFile / directory soft-skip', () => {
  let home: string | undefined
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true })
    home = undefined
  })

  test('readFileLines: directory path returns null (no throw)', async () => {
    home = join(tmpdir(), `sc214-dir-${process.pid}-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    const dirAsRc = join(home, '.bashrc')
    mkdirSync(dirAsRc, { recursive: true })
    const lines = await readFileLines(dirAsRc)
    expect(lines).toBeNull()
  })

  test('readFileLines: missing file returns null', async () => {
    home = join(tmpdir(), `sc214-miss-${process.pid}-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    const lines = await readFileLines(join(home, '.no-such-rc'))
    expect(lines).toBeNull()
  })

  test('findClaudeAlias: directory-as-config does not throw; returns null', async () => {
    home = join(tmpdir(), `sc214-alias-${process.pid}-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    // Make every shell config path a directory (densable hang surface)
    const paths = getShellConfigPaths({ homedir: home, env: {} })
    for (const p of Object.values(paths)) {
      mkdirSync(p, { recursive: true })
    }
    const alias = await findClaudeAlias({ homedir: home, env: {} })
    expect(alias).toBeNull()
  })

  test('findClaudeAlias: real alias still found when sibling is directory', async () => {
    home = join(tmpdir(), `sc214-mix-${process.pid}-${Date.now()}`)
    mkdirSync(home, { recursive: true })
    const paths = getShellConfigPaths({ homedir: home, env: {} })
    // zsh path as directory (bad), bash as real file with alias
    mkdirSync(paths.zsh, { recursive: true })
    writeFileSync(paths.bash, 'alias claude="/opt/claude/bin/claude"\n', 'utf8')
    // fish may not exist — leave missing (isFsInaccessible → null)
    const alias = await findClaudeAlias({ homedir: home, env: {} })
    expect(alias).toBe('/opt/claude/bin/claude')
  })
})
