import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  appendSettingsLoadWarning,
  getSettingsFileLoadWarning,
  pluginInstallFromSourceFromCliArgs,
  pluginInstallFromSourceHandler,
} from '../plugins.js'

describe('CLI Entrypoints & Plugin Handlers v2.1.292–v2.1.295 (#193, #296, #346)', () => {
  test('#193: pluginInstallFromSourceHandler and CLI arg parser are exported', () => {
    expect(typeof pluginInstallFromSourceHandler).toBe('function')
    expect(typeof pluginInstallFromSourceFromCliArgs).toBe('function')
  })

  test('#193: cli.tsx routes `claude plugin install ... --marketplace ...`', () => {
    const cliSrc = readFileSync(
      join(import.meta.dir, '../../../entrypoints/cli.tsx'),
      'utf8',
    )
    expect(cliSrc).toContain("args[0] === 'plugin'")
    expect(cliSrc).toContain('--marketplace')
    expect(cliSrc).toContain('pluginInstallFromSourceFromCliArgs')
  })

  test('#296: cli.tsx fast-paths logs/stop/kill/rm and daemon without OAuth refresh', () => {
    const cliSrc = readFileSync(
      join(import.meta.dir, '../../../entrypoints/cli.tsx'),
      'utf8',
    )
    expect(cliSrc).toContain('backgroundSessionVerbIndex')
    expect(cliSrc).toContain("'stop'")
    expect(cliSrc).toContain("'logs'")
    expect(cliSrc).toContain("'kill'")
    expect(cliSrc).toContain("'rm'")
    expect(cliSrc).toContain("args[0] === 'daemon'")
  })

  test('#346: getSettingsFileLoadWarning returns null for undefined or managed scope', () => {
    expect(getSettingsFileLoadWarning(undefined)).toBeNull()
    expect(getSettingsFileLoadWarning('managed')).toBeNull()
    expect(appendSettingsLoadWarning('ok', 'managed')).toBe('ok')
  })
})
