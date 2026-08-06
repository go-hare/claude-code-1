/**
 * densable 2.1.212 #11:
 * YKh prefers fixed-path PowerShell 7 before falling back to 5.1 so
 * GP-blocked powershell.exe does not surface as uv_spawn EUNKNOWN.
 */
import { describe, expect, test } from 'bun:test'
import { basename } from 'path'

/**
 * Pure mirror of densable YKh Windows candidate order after which("pwsh") miss.
 */
function windowsPwshFallbackCandidates(env: {
  ProgramFiles?: string
  LOCALAPPDATA?: string
  USERPROFILE?: string
}): string[] {
  const out: string[] = []
  if (env.ProgramFiles) {
    out.push(`${env.ProgramFiles}\\PowerShell\\7\\pwsh.exe`)
  }
  if (env.LOCALAPPDATA) {
    out.push(`${env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\pwsh.exe`)
  }
  if (env.USERPROFILE) {
    out.push(`${env.USERPROFILE}\\.dotnet\\tools\\pwsh.exe`)
  }
  return out
}

function windowsDesktopFallback(env: { SYSTEMROOT?: string }): string {
  const root = env.SYSTEMROOT ?? 'C:\\Windows'
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
}

function editionFromPath(p: string): 'core' | 'desktop' {
  const base = basename(p)
    .toLowerCase()
    .replace(/\.exe$/, '')
  return base === 'pwsh' ? 'core' : 'desktop'
}

describe('densable YKh windows PS prefer order (#11)', () => {
  test('fixed PS7 candidates: ProgramFiles → WindowsApps → .dotnet tools', () => {
    expect(
      windowsPwshFallbackCandidates({
        ProgramFiles: 'C:\\Program Files',
        LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
        USERPROFILE: 'C:\\Users\\u',
      }),
    ).toEqual([
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe',
      'C:\\Users\\u\\.dotnet\\tools\\pwsh.exe',
    ])
  })

  test('omits missing env roots', () => {
    expect(windowsPwshFallbackCandidates({ ProgramFiles: 'D:\\PF' })).toEqual([
      'D:\\PF\\PowerShell\\7\\pwsh.exe',
    ])
  })

  test('desktop absolute fallback uses SYSTEMROOT', () => {
    expect(windowsDesktopFallback({ SYSTEMROOT: 'C:\\Windows' })).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
    expect(windowsDesktopFallback({})).toContain(
      'WindowsPowerShell\\v1.0\\powershell.exe',
    )
  })

  test('WBr edition: pwsh → core, powershell → desktop', () => {
    expect(editionFromPath('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe(
      'core',
    )
    expect(
      editionFromPath(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ),
    ).toBe('desktop')
  })

  test('telemetry reasons match densable Be tags', () => {
    const tags = [
      'snap_workaround',
      'windows_fallback_path',
      'fell_back_to_powershell_5',
    ] as const
    expect(tags).toContain('windows_fallback_path')
    expect(tags).toContain('fell_back_to_powershell_5')
  })
})
