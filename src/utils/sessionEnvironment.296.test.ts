import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getSessionEnvironmentScript,
  getSessionEnvironmentVariables,
  invalidateSessionEnvCache,
} from './sessionEnvironment.js'

describe('sessionEnvironment v2.1.295-296 alignment (#413, #521)', () => {
  const prevEnvFile = process.env.CLAUDE_ENV_FILE
  const tempDirs: string[] = []

  afterEach(() => {
    invalidateSessionEnvCache()
    if (prevEnvFile === undefined) {
      delete process.env.CLAUDE_ENV_FILE
    } else {
      process.env.CLAUDE_ENV_FILE = prevEnvFile
    }
    for (const d of tempDirs.splice(0)) {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test('#521: getSessionEnvironmentVariables parses plain assignments and export/declare -x', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-env-521-'))
    tempDirs.push(dir)
    const envFile = join(dir, 'env.sh')
    writeFileSync(
      envFile,
      [
        '# comment',
        'FOO=bar',
        'export BAZ="hello world"',
        "declare -x QUX='single'",
      ].join('\n'),
    )
    process.env.CLAUDE_ENV_FILE = envFile
    invalidateSessionEnvCache()

    const vars = await getSessionEnvironmentVariables()
    expect(vars.get('FOO')).toBe('bar')
    expect(vars.get('BAZ')).toBe('hello world')
    expect(vars.get('QUX')).toBe('single')
  })

  test('#521: getSessionEnvironmentVariables returns empty Map when file has non-assignment shell code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-env-521-nonplain-'))
    tempDirs.push(dir)
    const envFile = join(dir, 'env.sh')
    writeFileSync(envFile, 'FOO=bar\necho "side effect"\n')
    process.env.CLAUDE_ENV_FILE = envFile
    invalidateSessionEnvCache()

    const vars = await getSessionEnvironmentVariables()
    expect(vars.size).toBe(0)
  })

  test('#413: getSessionEnvironmentScript reloads after invalidateSessionEnvCache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-env-413-'))
    tempDirs.push(dir)
    const envFile = join(dir, 'env.sh')
    writeFileSync(envFile, 'VAR_ONE=1\n')
    process.env.CLAUDE_ENV_FILE = envFile
    invalidateSessionEnvCache()

    expect(await getSessionEnvironmentScript()).toContain('VAR_ONE=1')
    writeFileSync(envFile, 'VAR_TWO=2\n')
    invalidateSessionEnvCache()
    expect(await getSessionEnvironmentScript()).toContain('VAR_TWO=2')
  })
})
