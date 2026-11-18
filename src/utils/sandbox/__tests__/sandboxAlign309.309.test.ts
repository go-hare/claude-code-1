import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runWithCwdOverride } from '../../cwd.js'
import {
  getProfileStoreDenyPaths,
  isClaudeSettingsPath,
  isProfileStorePath,
  setFlagMcpConfigFilePaths,
} from '../../permissions/filesystem.js'
import { expandSymlinkedDenyWriteGlobs } from '../sandbox-adapter.js'

describe('2.1.309 sandbox & protected path alignment (#1118, #1119, #1120, #1128)', () => {
  const tempDirs: string[] = []
  const origXdg = process.env.XDG_CONFIG_HOME

  afterEach(() => {
    setFlagMcpConfigFilePaths([])
    if (origXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = origXdg
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1118: Shell.ts strips -l/--login and deletes BASH_ENV/ENV when shouldUseSandbox', () => {
    const src = readFileSync(join(import.meta.dir, '../../Shell.ts'), 'utf-8')
    expect(src).toContain("arg !== '-l' && arg !== '--login'")
    expect(src).toContain('delete baseSubprocessEnv.BASH_ENV')
    expect(src).toContain('delete baseSubprocessEnv.ENV')
  })

  test('#1119: expandSymlinkedDenyWriteGlobs emits realpath-resolved glob for symlinked parent', () => {
    const root = mkdtempSync(join(tmpdir(), 'cc-1119-'))
    tempDirs.push(root)
    const realTarget = join(root, 'real-dir')
    const linkDir = join(root, 'link-dir')
    mkdirSync(realTarget, { recursive: true })
    symlinkSync(realTarget, linkDir)

    const expanded = expandSymlinkedDenyWriteGlobs([`${linkDir}/*.env`])
    expect(expanded).toContain(`${linkDir}/*.env`)
    expect(expanded).toContain(`${realpathSync(realTarget)}/*.env`)
  })

  test('#1120: setFlagMcpConfigFilePaths protects --mcp-config files in isClaudeSettingsPath', () => {
    const root = mkdtempSync(join(tmpdir(), 'cc-1120-'))
    tempDirs.push(root)
    const mcpFile = join(root, 'custom-mcp.json')
    writeFileSync(mcpFile, '{"mcpServers":{}}')

    expect(isClaudeSettingsPath(mcpFile)).toBe(false)
    setFlagMcpConfigFilePaths([mcpFile])
    expect(isClaudeSettingsPath(mcpFile)).toBe(true)
  })

  test('#1128: getProfileStoreDenyPaths & isProfileStorePath follow symlinks on config dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'cc-1128-'))
    tempDirs.push(root)
    const realConfig = join(root, 'real-xdg')
    const realAnthropic = join(realConfig, 'anthropic')
    mkdirSync(join(realAnthropic, 'configs'), { recursive: true })
    mkdirSync(join(realAnthropic, 'credentials'), { recursive: true })
    writeFileSync(join(realAnthropic, 'active_config'), 'default')

    const linkConfig = join(root, 'link-xdg')
    symlinkSync(realConfig, linkConfig)

    process.env.XDG_CONFIG_HOME = linkConfig
    const deny = getProfileStoreDenyPaths()
    expect(deny).not.toBeNull()
    const realAnthropicResolved = realpathSync(realAnthropic)
    // Outside cwd -> deny resolvedDir as a whole (SEA ye() / D(r))
    expect(deny!.dirs).toEqual([realAnthropicResolved])
    expect(deny!.files).toEqual([])

    expect(
      isProfileStorePath(
        join(realAnthropicResolved, 'credentials', 'tok.json'),
      ),
    ).toBe(true)
    expect(
      isProfileStorePath(join(linkConfig, 'anthropic', 'active_config')),
    ).toBe(true)
    expect(isProfileStorePath(join(root, 'unrelated.txt'))).toBe(false)
  })

  test('#1128: getProfileStoreDenyPaths narrows to configs/credentials/active_config when configDir contains cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'cc-1128-cwd-'))
    tempDirs.push(root)
    const storeDir = join(root, 'anthropic')
    const subCwd = join(storeDir, 'workspace')
    mkdirSync(join(storeDir, 'configs'), { recursive: true })
    mkdirSync(join(storeDir, 'credentials'), { recursive: true })
    mkdirSync(subCwd, { recursive: true })
    writeFileSync(join(storeDir, 'active_config'), 'default')

    try {
      process.env.ANTHROPIC_CONFIG_DIR = storeDir
      const deny = runWithCwdOverride(subCwd, () => getProfileStoreDenyPaths())
      expect(deny).not.toBeNull()
      const storeResolved = realpathSync(storeDir)
      expect(deny!.dirs).toEqual([
        join(storeResolved, 'configs'),
        join(storeResolved, 'credentials'),
      ])
      expect(deny!.files).toEqual([join(storeResolved, 'active_config')])
    } finally {
      delete process.env.ANTHROPIC_CONFIG_DIR
    }
  })
})
