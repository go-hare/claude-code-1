# Verdict — go-hare #13 embedded ripgrep (densable 2.1.235)

**status:** `HAVE`  
**date:** 2026-08-20  
**SEA:** `@anthropic-ai/claude-code-darwin-arm64@2.1.235` · argv0=`rg` embed **14.1.1**  
**local:** sidecar microsoft/ripgrep-prebuilt **v15.0.1** → `15.0.0 rev 3a612f88b8`（**新于** SEA）  
**user:** 版本更新 / 打包差异「不是问题」→ **HAVE** + 加强笔记

## Decision

**HAVE** — GrepTool-visible product claims landed: `-m`/`-A`/`-C` + native pathological fail-fast on densable-aligned vendor **15.0.x**, plus densable `rejectOnInputError`/`RipgrepUsageError`. Local binary is **newer** than SEA embed 14.1.1 — **do not downgrade**. Sidecar vs SEA Mach-O argv0 embed / no `N4Grep*` port are **non-blocking packaging notes**, not a product GAP.

## Evidence matrix

| Claim | SEA gold | Local | Notes |
| --- | --- | --- | --- |
| Identity | `ripgrep 14.1.1 (rev fdb5e06cce)` | `ripgrep 15.0.0 (rev 3a612f88b8)` | Local **newer**. Keep. |
| Packaging | argv0 embed in Mach-O | vendor sidecar | Note only — does not demote HAVE. |
| Patho / `-m` context | OK | OK | Locked by `embeddedRipgrep.235`. |
| Wrapper YTm/iaT | densable | Wired Grep+Glob | `ripgrepUsageError.235`. |

Authoritative board counts: HAVE **18** / PARTIAL **0** / GAP **0** / N/A **1** (#19).

## Non-claims

- Not claiming bit-identical SEA Mach-O embed
- Not claiming local has `N4Grep*`
- Not inventing JS pathological fail-fast
- Not authorizing auto-commit / bump
