/**
 * densable 2.1.214 Batch C — PowerShell provider #21/#22/#23/#25.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  createPowerShellProvider,
  POWERSHELL_DEFAULT_ENV,
  POWERSHELL_ENCODING_PREAMBLE,
  shouldSkipPowerShellEncodingPreamble,
} from '../powershellProvider.js'

describe('densable vrg shouldSkipPowerShellEncodingPreamble', () => {
  test('plain command does not skip', () => {
    expect(shouldSkipPowerShellEncodingPreamble('Get-ChildItem')).toBe(false)
  })

  test('using namespace skips', () => {
    expect(
      shouldSkipPowerShellEncodingPreamble('using namespace System; 1'),
    ).toBe(true)
  })

  test('param() skips', () => {
    expect(shouldSkipPowerShellEncodingPreamble('param($x) $x')).toBe(true)
  })

  test('begin { skips', () => {
    expect(shouldSkipPowerShellEncodingPreamble('begin { } process { }')).toBe(
      true,
    )
  })

  test('[Type]::Method does not skip (static call)', () => {
    expect(
      shouldSkipPowerShellEncodingPreamble('[Console]::WriteLine(1)'),
    ).toBe(false)
  })

  test('[int]$x type literal skips', () => {
    expect(shouldSkipPowerShellEncodingPreamble('[int]$x = 1')).toBe(true)
  })

  test('leading comment then command does not skip', () => {
    expect(shouldSkipPowerShellEncodingPreamble('# hi\nGet-Date')).toBe(false)
  })
})

describe('createPowerShellProvider densable 214', () => {
  const saved: Record<string, string | undefined> = {}

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    for (const k of Object.keys(saved)) delete saved[k]
  })

  test('stdin is ignore (#21)', () => {
    const p = createPowerShellProvider('pwsh')
    expect(p.stdin).toBe('ignore')
    expect(p.detached).toBe(false)
  })

  test('preamble prepended for normal command (#25)', async () => {
    const p = createPowerShellProvider('pwsh')
    const { commandString } = await p.buildExecCommand('Write-Output 1', {
      id: 't1',
      useSandbox: false,
    })
    expect(commandString.startsWith(POWERSHELL_ENCODING_PREAMBLE)).toBe(true)
    expect(commandString).toContain('Write-Output 1')
    expect(commandString).toContain('Out-File:Encoding')
    expect(commandString).toContain('SetShouldExit')
  })

  test('preamble skipped for using namespace', async () => {
    const p = createPowerShellProvider('pwsh')
    const { commandString } = await p.buildExecCommand(
      'using namespace System; [Math]::Abs(-1)',
      { id: 't2', useSandbox: false },
    )
    expect(commandString.startsWith(POWERSHELL_ENCODING_PREAMBLE)).toBe(false)
    expect(commandString.startsWith('using namespace')).toBe(true)
  })

  test('PYTHONIOENCODING default when unset (#22)', async () => {
    saved.PYTHONIOENCODING = process.env.PYTHONIOENCODING
    delete process.env.PYTHONIOENCODING
    const p = createPowerShellProvider('pwsh')
    const env = await p.getEnvironmentOverrides('echo 1')
    expect(env.PYTHONIOENCODING).toBe(POWERSHELL_DEFAULT_ENV.PYTHONIOENCODING)
  })

  test('does not override existing PYTHONIOENCODING', async () => {
    saved.PYTHONIOENCODING = process.env.PYTHONIOENCODING
    process.env.PYTHONIOENCODING = 'ascii'
    const p = createPowerShellProvider('pwsh')
    const env = await p.getEnvironmentOverrides('echo 1')
    expect(env.PYTHONIOENCODING).toBeUndefined()
  })

  test('NO_COLOR skipped when FORCE_COLOR set', async () => {
    saved.FORCE_COLOR = process.env.FORCE_COLOR
    saved.NO_COLOR = process.env.NO_COLOR
    delete process.env.NO_COLOR
    process.env.FORCE_COLOR = '1'
    const p = createPowerShellProvider('pwsh')
    const env = await p.getEnvironmentOverrides('echo 1')
    expect(env.NO_COLOR).toBeUndefined()
  })
})
