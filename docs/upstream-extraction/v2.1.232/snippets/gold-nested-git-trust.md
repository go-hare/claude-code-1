# densable 2.1.232 #15 — Nested git does not inherit parent trust

## Changelog

> Nested git repositories no longer inherit trust from parent directories

## Gold (`TR_` / `ged` / `yed` / `v6e`)

SEA offset ~286946760 (`claude.exe` 2.1.232):

```js
function TR_() {
  if (X.CLAUDE_CODE_SANDBOXED) return !0
  if (XGe()) return !0
  if ($s()) return !0
  let e = or(), t = wAt()
  if (e.projects?.[t]?.hasTrustDialogAccepted) return !0
  return ged(e, Tn())
}

// ged: resolve path, findGitRoot (QEo), bound walk
function ged(e, t) {
  let r = qu(mb.resolve(t))
  let n = QEo(r)
  let o = n !== null ? lot(mb.resolve(n)) : null
  return yed(e, r, o)
}

// yed: pure ancestor walk; never cross above gitRootKey
function yed(e, t, r) {
  let n = lot(t)
  while (!0) {
    if (!(r === null || n === r || n.startsWith(r.endsWith("/") ? r : r + "/")))
      return !1
    if (e.projects?.[n]?.hasTrustDialogAccepted) return !0
    if (n === r) return !1  // at git root without match — stop (no parent-repo inherit)
    let i = lot(mb.resolve(n, ".."))
    if (i === n) return !1
    n = i
  }
}

// v6e = isPathTrusted
function v6e(e, { advisoryNoFsProbe: t = !1 } = {}) {
  let r = or()
  if (t) return yed(r, qu(mb.resolve(e)), null)  // unbounded advisory
  if (r.projects?.[f8(e)]?.hasTrustDialogAccepted === !0) return !0  // f8 = canonical project key
  return ged(r, e)
}
```

## Semantics

| Case | Result |
| ---- | ------ |
| Trust saved on parent repo; cwd is nested `.git` repo under it | **untrusted** (walk stops at nested root) |
| Trust on nested root; path inside nested | **trusted** |
| Trust on parent; path is subdirectory of **same** repo (no nested `.git`) | **trusted** (bound = parent root) |
| `advisoryNoFsProbe` | unbounded parent walk (legacy) |

## Local map

| densable | local |
| -------- | ----- |
| `yed` | `walkHasTrustDialogAcceptedBounded` |
| `ged` | `walkHasTrustDialogAccepted` (`findGitRoot` bound) |
| `v6e` | `isPathTrusted` |
| `TR_` | `computeTrustDialogAccepted` → project key then `ged` |
| `QEo` | `findGitRoot` |
| `f8`/`Rws`/`Bqt` | `findCanonicalGitRoot` + `normalizePathForConfigKey` |
| `lot` | `normalizePathForConfigKey` |

Tests: `src/utils/__tests__/nestedGitTrust.232.test.ts`
