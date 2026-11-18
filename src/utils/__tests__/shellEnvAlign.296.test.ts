import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Shell.ts env alignment (#383 & #521)', () => {
  const shellSrc = readFileSync(join(import.meta.dir, '../Shell.ts'), 'utf8')

  test('#383: Shell.ts strips daemon-injected FORCE_COLOR=3 from child subprocess env', () => {
    expect(shellSrc).toContain(
      'stripDaemonForceColorFromEnv(baseSubprocessEnv)',
    )
  })

  test('#521: Shell.ts loads plain-assignment CLAUDE_ENV_FILE vars for PowerShell', () => {
    expect(shellSrc).toContain("if (shellType === 'powershell')")
    expect(shellSrc).toContain('getSessionEnvironmentVariables()')
  })
})
