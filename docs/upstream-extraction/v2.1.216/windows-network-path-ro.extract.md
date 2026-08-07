# densable 2.1.216 — Windows RO network/UNC path permission (1:1)

> **id:** `windows-network-path-ro` · Changelog #20  
> **Status:** **HAVE** (path-mode `sI` + Rjr gate; RO command path-mode)  
> SEA: `/tmp/official-216/plat/package/claude`  
> Landed: 2026-08-06

---

## 1. Product intent (changelog)

> Fixed read-only commands on Windows accessing network paths without a permission prompt

Read-only auto-allow must **not** cover UNC / network paths on Windows — always prompt.

---

## 2. densable binary proof

| Needle | Hit | Notes |
|--------|-----|-------|
| `function sI(e,t=!1)` | 1 | UNC detector |
| `function Rjr(e,t,r,n)` | 1 | `validatePath` |
| `sI(o,!0)` in Rjr | 1 | **path mode** |
| `UNC network paths require manual approval` | reason | |
| `sI(...,!0)` on RO argv/redirects | many | PS + bash RO |

### densable `sI` (cleaned)

```js
function sI(e, t = false) {
  if (It() !== 'windows') return false
  if (t && /^[\\/]{2}/.test(e)) return true
  if (t && /^-[A-Za-z0-9]/.test(e)) {
    const s = e.replace(/^(?:-[A-Za-z0-9]+)+/, '')
    if (s.length > 0 && sI(s, true)) return true
  }
  if (/\\\\[^ \t\r\n\f\v\\/]+(?:@(?:\d+|ssl))?(?:[\\/]|$|\s)/i.test(e)) return true
  if (/(?<!:)\/\/[^ \t\r\n\f\v\\/]+(?:@(?:\d+|ssl))?(?:[\\/]|$|\s)/i.test(e)) return true
  // path mode: single separator mixed; command mode: 2+
  if ((t ? /(?<![:\w])\/\\{1,}[^ \t\r\n\f\v\\/]+[\\/]/ : /\/\\{2,}[^ \t\r\n\f\v\\/]/).test(e)) return true
  if ((t ? /(?<![:\w])\\{1,}\/[^ \t\r\n\f\v\\/]+[\\/]/ : /\\{2,}\/[^ \t\r\n\f\v\\/]/).test(e)) return true
  if (/@SSL@\d+/i.test(e) || /@\d+@SSL/i.test(e)) return true
  if (/DavWWWRoot/i.test(e)) return true
  // IPv4 / IPv6 UNC …
  return false
}
```

### densable `Rjr` (validatePath head)

```js
function Rjr(e, t, r, n) {
  let o = LL(e)
  if (sI(o, true))
    return { allowed: false, resolvedPath: o, decisionReason: { type: 'other', reason: 'UNC network paths require manual approval' } }
  if (o.startsWith('~')) /* tilde variants */
  if (o.includes('$') || (It() === 'windows' && o.includes('%')) || o.includes('`') || o.startsWith('='))
    return { /* Shell expansion syntax… */ }
  // … Ajr .. traversal, brace write, globs …
}
```

---

## 3. Local port map

| densable | Local |
|----------|--------|
| `sI(e,t)` | `containsVulnerableUncPath(pathOrCommand, forPath=false)` |
| `Rjr` UNC + expansion | `validatePath` |
| RO gates | Bash `readOnlyValidation` + PS `powershellPermissions` call `forPath: true` |

---

## 4. Residuals

1. densable host class is `[^ \t\r\n\f\v\\/]+` not `\s` — ported.  
2. `%` expansion gate is **windows-only** in densable — ported (was all-platform).  
3. backtick in path — densable Rjr; ported.  
4. Brace-write / `Ajr` `..` segment gate — separate from #20; not expanded here unless already present.

---

## 5. Tests

- `src/utils/shell/__tests__/uncNetworkPath.216.test.ts`

---

## 6. Definition of done

- [x] path-mode `sI` parity  
- [x] Rjr UNC reason string  
- [x] RO command path-mode  
- [x] `.216` tests  
