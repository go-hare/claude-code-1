# densable 2.1.214 Batch C — PowerShell / Windows / keep-alive

> Binary: `%TEMP%/official-214/package/claude.exe` · extract-first 1:1

## #21 stdin hang

densable `$Gc` / `createPowerShellProvider`:

```js
return {
  type: "powershell",
  shellPath: e,
  detached: !1,
  stdin: "ignore",
  async buildExecCommand(...) { ... }
}
```

Shell spawn must honor `provider.stdin` as stdio[0] (not hardcode `"pipe"`).

## #22 / #23 / #25 encoding

densable `Erg` preamble (prepended unless `vrg` detects using/param/begin…):

```
try { $PSDefaultParameterValues['Out-File:Encoding'] = 'utf8' } catch {};
if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage') {
  try { $OutputEncoding = [System.Text.UTF8Encoding]::new() } catch {};
  if ($null -ne $PSStyle) { try { $PSStyle.OutputRendering = 'PlainText' } catch {} }
};
```

densable `Arg` env defaults (only if not already set):

```js
Arg = {
  PYTHONIOENCODING: "utf-8:surrogateescape",
  NO_COLOR: "1",
}
```

`vrg(command)` skips Erg when leading statement is `using` / `param(` / `begin|process|end|clean|dynamicparam {` / type literal `[Word` not `::`.

## #24 where / fc / diff exit semantics

```js
F7r = (msg) => (code) => ({ isError: code !== 0 && code !== 1, message: code === 1 ? msg : undefined })
Air = F7r("No matches found")
Dny = F7r("Files differ")
Pny = Map(grep/rg/egrep/fgrep/findstr → Air, robocopy → bitfield)
Lny = Map(where → F7r("No matching files found"), fc → Dny, diff → Dny)

// apply Lny only when nativeExt === "exe" AND (stdout||stderr non-empty)
// git grep/diff special-case via subcommand
```

`Qhs` strips call ops / quotes / path; detects `.exe|.cmd|.bat` nativeExt.

## #18 / #46 Socket closed + keep-alive

densable `T2` (extractConnectionErrorDetails):

- walk cause chain for `.code`
- **also**: `message.startsWith("The socket connection was closed unexpectedly")` → `{ code: "ConnectionClosed" }`

densable stale set `Cye`:

```
ECONNRESET, EPIPE, ConnectionClosed, ETIMEDOUT, ECONNABORTED,
ERR_SOCKET_CLOSED, StreamSuspended
```

densable retry (`EYy` / `Dbo`): on stale → **always** `disableKeepAlive()` (no GrowthBook gate).

Local gap before this batch: only ECONNRESET|EPIPE + GB `tengu_disable_keepalive_on_econnreset` default false.
