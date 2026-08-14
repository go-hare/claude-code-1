# densable 2.1.232 #46 — cross-session socket dir 拒 symlink/他人目录

## Changelog

> cross-session socket dir：拒 symlink/他人目录

## densable gold (SEA 2.1.232)

### Product intent (UDS cross-session messaging)

Before binding a cross-session Unix domain socket:

1. Socket **parent** must be a real directory (not a file, not a symlink)
2. Parent must be private: mode without group/other bits (`0o077 == 0`), owner == current uid (non-win32)
3. Missing parent → `mkdir(..., { mode: 0o700 })` + `chmod 0o700`
4. Failure wraps with refuse-to-bind messaging prefix

### densable strings (SEA)

```text
refusing to bind:
 is owned by uid
ENOTOWNED
```

Daemon socket tree (`HLp`/`RLp` / `cc-daemon-*`) uses the same **ownership refuse** pattern with code `ENOTOWNED` — **separate** from UDS messaging sockets. Chrome MCP has its own 0700/0600 socket checks. Do **not** invent a merge of those trees into UDS.

## Local (UDS product path)

- `src/utils/udsMessaging.ts`
  - `ensureSocketParent(path)` — lstat parent; refuse non-dir / symlink; `assertPrivateDirectory`; mkdir 0o700
  - `assertPrivateDirectory` — not dir/symlink; broad mode `mode & 0o077`; wrong uid
  - capability dir: same private asserts + 0o700
  - error prefix: `[uds-messaging] Failed to set up sockets directory (refusing to bind): …`
- Runtime tests in `udsMessaging.test.ts`:
  - capability dir symlink → `not a private directory`
  - explicit socket parent mode 0755 → `socket parent permissions are too broad`
  - socket parent is file → `socket parent is not a directory`
- Source lock: `crossSessionSocketDir.232.test.ts`

## Residual (not required for UDS HAVE)

- densable daemon `HLp`/`RLp` ENOTOWNED throw shape on `cc-daemon-*` tree — local daemon may use different helpers; out of #46 UDS scope unless product unifies
- Chrome MCP 0700 socket dir strings — separate product surface
