# densable 2.1.212 — #11 Windows `/background` & `--bg` prefer PowerShell 7

Changelog:

> Fixed `/background` and `claude --bg` failing with "EUNKNOWN: unknown error, uv_spawn" on Windows when Group Policy blocks PowerShell 5.1; the daemon now prefers PowerShell 7

## densable `YKh` (`powershellDetection` / shell_powershell_detect)

```js
async function CKt(e) {
  try {
    return (await h0t.stat(e)).isFile() ? e : null
  } catch {
    return null
  }
}
async function KKh(e) {
  let t
  try {
    t = await h0t.readlink(e)
  } catch {
    return null
  }
  return CKt(t)
}
async function YKh() {
  let e = await ky('pwsh')
  if (e) {
    if (Pt() === 'linux') {
      /* snap_workaround → /opt/microsoft/powershell/7/pwsh or /usr/bin/pwsh */
    }
    return Ae('shell_powershell_detect'), e
  }
  if (Pt() === 'windows') {
    let r = Z.ProgramFiles,
      n = Z.LOCALAPPDATA,
      o = Z.USERPROFILE,
      i =
        (r ? await CKt(jBr.join(r, 'PowerShell', '7', 'pwsh.exe')) : null) ??
        (n
          ? await KKh(jBr.join(n, 'Microsoft', 'WindowsApps', 'pwsh.exe'))
          : null) ??
        (o ? await CKt(jBr.join(o, '.dotnet', 'tools', 'pwsh.exe')) : null)
    if (i) return Be('shell_powershell_detect', 'windows_fallback_path'), i
  }
  let t = await ky('powershell')
  if (t) return Be('shell_powershell_detect', 'fell_back_to_powershell_5'), t
  if (Pt() === 'windows') {
    let r = Z.SYSTEMROOT ?? 'C:\\Windows',
      n = await CKt(
        jBr.join(r, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      )
    if (n) return Be('shell_powershell_detect', 'fell_back_to_powershell_5'), n
  }
  return null
}
```

Telemetry tags:

| path | tag |
|------|-----|
| PATH `pwsh` | `Ae("shell_powershell_detect")` |
| linux snap → real binary | `snap_workaround` |
| Windows fixed PS7 | `windows_fallback_path` |
| PATH/absolute 5.1 | `fell_back_to_powershell_5` |

## Why uv_spawn / EUNKNOWN

When Group Policy blocks Windows PowerShell 5.1, spawning `powershell.exe` can fail at libuv with opaque `EUNKNOWN: unknown error, uv_spawn`. Preferring fixed-path PS7 (`ProgramFiles\PowerShell\7\pwsh.exe`) before 5.1 avoids that for daemon/bg/hooks that use `getCachedPowerShellPath`.

## Local alignment

| densable | local |
|----------|-------|
| `YKh` | `findPowerShell` in `powershellDetection.ts` |
| `CKt` / `KKh` | `probePath` / `probeWindowsAppsAlias` |
| `pX` / `WBr` | `getCachedPowerShellPath` / `getPowerShellEdition` |
| windows_fallback_path | ProgramFiles / WindowsApps readlink / .dotnet tools |
| absolute 5.1 | `SYSTEMROOT\System32\WindowsPowerShell\v1.0\powershell.exe` |

Daemon/bg already consume `getCachedPowerShellPath` / shell providers — no separate spawn path needed once detection prefers PS7.
