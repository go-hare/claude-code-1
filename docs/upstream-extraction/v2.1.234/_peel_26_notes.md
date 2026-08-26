# densable 2.1.234 #26 — `/login` + OAUTH_TOKEN 提醒不进模型 turn

> Changelog: *Fixed /login OAUTH_TOKEN reminder entering the model turn*

## Gold (SEA)

| Symbol | Role |
|--------|------|
| `ARh` / `o9m` | pre-login banner when `CLAUDE_CODE_OAUTH_TOKEN` set |
| `wRh` / `n9m` | shared profile/settings trailing clause |
| `L8l` / `i9m` | post-success note (snapshot at `/login` start) |
| `TRh` | `none` / `inline` / `out-of-band` |
| `kRh` / `s9m` | onDone stdout; env note only when `includeEnvTokenWarning` |
| `ERh` | last message `isApiErrorMessage && error==="authentication_failed"` → `{display:"system", shouldQuery:true}` |
| `Xrn` | if `TRh==="out-of-band"` → `applyMessageOp(zs(L8l,"notice"))` once |

`TRh`: no env / gateway → `none`; `willAutoQuery` → `out-of-band`; else `inline`.

## Local 1:1

| densable | Local |
|----------|-------|
| `TRh` | `resolveOauthTokenEnvWarningPlacement` |
| `ERh` | `lastMessageRequestsAuthRetry` (last message only) |
| `kRh` include flag | `formatLoginDoneMessage({includeEnvTokenWarning})` |
| `zs(L8l,"notice")` | `createSystemMessage(..., 'info')` via `setMessages` |
| `Xrn` options | `onDone(..., {display:'system', shouldQuery:true})` when auto-query |

Invent-ban: no `accountSwitched` / `relaunching` / `gatewayLoginError` cloud restart path.

## Tests

`src/commands/login/__tests__/oauthTokenEnvWarning.229.test.ts` — TRh/ERh/kRh.

## Status

**HAVE** (targeted).
