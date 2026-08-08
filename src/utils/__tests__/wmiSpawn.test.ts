import { describe, expect, test } from 'bun:test'
import {
  buildDaemonSpawnEnv,
  buildWindowsCommandLine,
  buildWmiPowerShellScript,
  quotePowerShellSingle,
  quoteWindowsArg,
  spawnViaWmiSync,
} from '../wmiSpawn.js'

describe('quoteWindowsArg (official nAO)', () => {
  test('leaves bare tokens unquoted', () => {
    expect(quoteWindowsArg('C:\\Users\\bin\\bun.exe')).toBe(
      'C:\\Users\\bin\\bun.exe',
    )
    expect(quoteWindowsArg('--feature')).toBe('--feature')
    expect(quoteWindowsArg('daemon')).toBe('daemon')
  })

  test('double-quotes args with spaces', () => {
    expect(quoteWindowsArg('C:\\Program Files\\bun.exe')).toBe(
      '"C:\\Program Files\\bun.exe"',
    )
  })

  test('escapes embedded double quotes', () => {
    expect(quoteWindowsArg('a"b')).toBe('"a\\"b"')
  })

  test('doubles trailing backslashes only when the token is quoted', () => {
    // Bare path with trailing slash has no space/quote → stays bare (official nAO).
    expect(quoteWindowsArg('C:\\dir\\')).toBe('C:\\dir\\')
    // Once quoted (space present), backslashes before the closing quote double.
    expect(quoteWindowsArg('C:\\Program Files\\')).toBe(
      '"C:\\Program Files\\\\"',
    )
  })
})

describe('buildWindowsCommandLine (official lAO)', () => {
  test('does not single-quote every argv (rc=9 root cause)', () => {
    const line = buildWindowsCommandLine([
      'C:\\Users\\Administrator\\.bun\\bin\\bun.exe',
      '-d',
      'MACRO.VERSION:"2.6.31"',
      'D:\\work\\py\\claude\\claude-code\\src\\entrypoints\\cli.tsx',
      'daemon',
      'run',
      '--origin',
      'transient',
    ])
    // Must not look like PowerShell single-quoted tokens.
    expect(line).not.toContain("'''")
    expect(line.startsWith("'")).toBe(false)
    expect(line).toContain('bun.exe')
    expect(line).toContain('daemon run --origin transient')
    // Version define has a colon+quote → must be double-quoted as one arg.
    expect(line).toContain('"MACRO.VERSION:\\"2.6.31\\""')
  })
})

describe('quotePowerShellSingle (official iAO)', () => {
  test('wraps and doubles single quotes', () => {
    expect(quotePowerShellSingle("it's")).toBe("'it''s'")
  })

  test('rejects smart quotes', () => {
    expect(() => quotePowerShellSingle('say \u2018hi\u2019')).toThrow(
      /unsupported Unicode single-quote/,
    )
  })
})

describe('buildWmiPowerShellScript (official cAO)', () => {
  test('uses EncodedCommand-ready body with ProcessStartupInformation', () => {
    const script = buildWmiPowerShellScript(
      'C:\\bin\\claude.exe daemon run --origin transient',
    )
    expect(script).toContain('Win32_ProcessStartup')
    expect(script).toContain('ShowWindow = [uint16]0')
    expect(script).toContain('CreateFlags = [uint32]8')
    expect(script).toContain('CurrentDirectory = $env:USERPROFILE')
    expect(script).toContain('exit $r.ReturnValue')
    // CommandLine is one PowerShell single-quoted literal of the full line.
    expect(script).toContain(
      "CommandLine = 'C:\\bin\\claude.exe daemon run --origin transient'",
    )
    expect(script).not.toContain('Write-Output')
  })

  test('emitProcessId + custom cwd for worker nqq path', () => {
    const script = buildWmiPowerShellScript(
      'C:\\bin\\claude.exe --bg-pty-host sock 200 50 -- claude -p',
      {
        currentDirectory: 'D:\\job\\cwd',
        emitProcessId: true,
      },
    )
    expect(script).toContain("CurrentDirectory = 'D:\\job\\cwd'")
    expect(script).toContain(
      'if ($r.ReturnValue -eq 0 -and $r.ProcessId) { Write-Output $r.ProcessId }',
    )
    expect(script).toContain('ShowWindow = [uint16]0')
    expect(script).toContain('CreateFlags = [uint32]8')
  })
})

describe('buildDaemonSpawnEnv (official rAO)', () => {
  test('clears INVOCATION_ID', () => {
    const env = buildDaemonSpawnEnv({
      ...process.env,
      INVOCATION_ID: 'keep-me',
    })
    expect(env.INVOCATION_ID).toBe('')
  })
})

describe('spawnViaWmiSync (Windows flash path)', () => {
  test('spawns a short-lived process with pid when on win32', () => {
    if (process.platform !== 'win32') {
      // API still rejects empty argv everywhere
      expect(spawnViaWmiSync([], process.env).ok).toBe(false)
      return
    }
    const result = spawnViaWmiSync(
      [process.execPath, '-e', 'setTimeout(()=>{}, 1500)'],
      process.env,
      { timeoutMs: 10_000 },
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.pid).toBeGreaterThan(0)
      try {
        process.kill(result.pid)
      } catch {
        /* already exited */
      }
    }
  })
})
