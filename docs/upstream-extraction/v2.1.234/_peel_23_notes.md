# densable 2.1.234 #23 — trust prompts omitting repository-wide scope warning

> Changelog: *Fixed trust prompts omitting repository-wide scope warning when directory was first seen before the repository existed there*

## Gold (SEA)

| Symbol | Role |
|--------|------|
| `Kdu` | Uncached `.git` walk |
| `Yc` / `cTt(rootByPath,…)` | Cached walk (`findGitRoot`) — **negative miss sticky** |
| `rHo` | **Uncached** walk = `Kdu` without LRU |
| `Rat` | If LRU holds `_0e` negative for path → `delete` + `Yc` |
| `Ydu` | Resolve worktree → canonical main root (uncached) |
| `bd` | Cached `Yc` + `cTt(canonicalRootByRoot, Ydu)` |
| `I8e` | **`rHo` → `Ydu`** — trust prompts / trust keys |
| `RYt` / `W9` / `aKe` / `yCt` | Trust key + isTrusted + accept via `I8e` |
| `JqE` / `dFl` / set_cwd `BqE` | `trustRoot: I8e(dir)` when distinct |

Accessing workspace TrustDialog itself still has **no** repo-root sentence in SEA (CdTrustPrompt / set_cwd do). Local go-hare continues to show CdTrustPrompt copy on Accessing when under a distinct root (#28), but must probe via `I8e`/`rHo`.

`wasTrustedBeforeSetup` / `wasPersistedTrustedBeforeSetup` (`Xn=_f()`, `ro=p3()`) gate **permission bootstrap** after setup (`if(!Xe&&_f()||!Pe&&p3())`), not the repo-wide warning string. Not the #23 fix surface.

## Bug mechanism

1. Path probed while **not** a git repo → `Yc` caches `_0e` / `GIT_ROOT_NOT_FOUND`.
2. Later `.git` appears (init / clone into already-seen dir).
3. Trust prompt still used **cached** root → `trustRoot` omitted → no “This directory is part of the repository at …” warning.

## Local 1:1 port

| densable | Local |
|----------|-------|
| `Kdu` | `probeGitRoot` |
| `Yc` | `findGitRoot` (LRU) |
| `rHo` | `findGitRootUncached` |
| `Rat` | `refreshFindGitRoot` |
| `Ydu` | `resolveCanonicalRootImpl` |
| `bd` | `findCanonicalGitRoot` |
| `I8e` | `findCanonicalGitRootUncached` |

Wired into:

- `projectTrustConfigKey` / `isPathTrusted` / `walkHasTrustDialogAccepted` (bound via `rHo`)
- `/cd` `CdTrustPrompt` + `set_cwd` `trust_root`
- Accessing `TrustDialog` `resolveTrustRootNote` injectors
- `RemoteControlAddServerDialog` trust body (Uncached after verifier FAIL)

## Tests

`src/utils/__tests__/gitRootUncached.234.test.ts` — negative LRU vs uncached I8e/rHo; Rat; uncached does not write LRU.

## Status

**HAVE** (targeted tests + filtered typecheck/biome; RC Uncached wired). Full `precheck` deferred (user hang complaint).
