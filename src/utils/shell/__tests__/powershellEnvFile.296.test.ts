import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createPowerShellProvider,
  parsePlainEnvAssignments,
} from '../powershellProvider.js'

describe('powershellProvider #521 CLAUDE_ENV_FILE & #383 FORCE_COLOR=3', () => {
  const tempDirs: string[] = []
  const origEnvFile = process.env.CLAUDE_ENV_FILE
  const origBgBackend = process.env.CLAUDE_BG_BACKEND
  const origForceColor = process.env.FORCE_COLOR
  const origNoColor = process.env.NO_COLOR

  afterEach(() => {
    if (origEnvFile === undefined) delete process.env.CLAUDE_ENV_FILE
    else process.env.CLAUDE_ENV_FILE = origEnvFile
    if (origBgBackend === undefined) delete process.env.CLAUDE_BG_BACKEND
    else process.env.CLAUDE_BG_BACKEND = origBgBackend
    if (origForceColor === undefined) delete process.env.FORCE_COLOR
    else process.env.FORCE_COLOR = origForceColor
    if (origNoColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = origNoColor
    for (const d of tempDirs.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('#521: parsePlainEnvAssignments parses export/plain/quoted lines', () => {
    const parsed = parsePlainEnvAssignments(
      [
        '# comment',
        '',
        'FOO=bar',
        'export BAZ="hello world"',
        "declare -x QUX='single_val'",
      ].join('\n'),
      'linux',
    )
    expect(parsed.get('FOO')).toBe('bar')
    expect(parsed.get('BAZ')).toBe('hello world')
    expect(parsed.get('QUX')).toBe('single_val')
  })

  test('#521: parsePlainEnvAssignments returns empty Map on non-plain shell syntax', () => {
    const parsed = parsePlainEnvAssignments(
      ['FOO=bar', 'if [ -f /tmp/x ]; then export BAZ=1; fi'].join('\n'),
      'linux',
    )
    expect(parsed.size).toBe(0)
  })

  test('#521: parsePlainEnvAssignments drops path-sep values on Windows', () => {
    const parsed = parsePlainEnvAssignments(
      ['FOO=bar', 'POSIX_PATH=/usr/local/bin'].join('\n'),
      'windows',
    )
    expect(parsed.get('FOO')).toBe('bar')
    expect(parsed.has('POSIX_PATH')).toBe(false)
  })

  test('#521: getEnvironmentOverrides applies plain CLAUDE_ENV_FILE assignments', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ps-env-'))
    tempDirs.push(dir)
    const envFile = join(dir, 'hook.env')
    writeFileSync(envFile, 'export HOOK_VAR=from_hook\nPLAIN_VAR="abc"\n')
    process.env.CLAUDE_ENV_FILE = envFile

    const provider = createPowerShellProvider('pwsh')
    const env = await provider.getEnvironmentOverrides(process.cwd())
    expect(env.HOOK_VAR).toBe('from_hook')
    expect(env.PLAIN_VAR).toBe('abc')
  })

  test('#383: daemon-injected FORCE_COLOR=3 still sets NO_COLOR=1 in PowerShell', async () => {
    delete process.env.NO_COLOR
    process.env.CLAUDE_BG_BACKEND = 'daemon'
    process.env.FORCE_COLOR = '3'

    const provider = createPowerShellProvider('pwsh')
    const env = await provider.getEnvironmentOverrides(process.cwd())
    expect(env.NO_COLOR).toBe('1')
  })
})
