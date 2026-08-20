# #13 embedded/vendor ripgrep — verdict

Updated: 2026-08-20

## Status: **HAVE**

User: 本地 rg 比官方新「不是问题」→ 升 HAVE；打包差异写加强笔记即可。

## Product landed（HAVE gate）

- Local sidecar: microsoft/ripgrep-prebuilt **v15.0.1** (reports `ripgrep 15.0.0 rev 3a612f88b8`)
- SEA reference: argv0-embed `ripgrep 14.1.1 (rev fdb5e06cce)`
- **Local is newer than SEA — do not downgrade**
- Behavior probes: `-m` / `-A` / `-C` + pathological fail-fast 1:1
- densable wrapper: `rejectOnInputError` + `RIPGREP_INPUT_ERROR_RE` (iaT) + `RipgrepUsageError` (YTm)
- Wired: `GrepTool` + `glob.ts`
- Tests: `embeddedRipgrep.235.test.ts` + `ripgrepUsageError.235.test.ts`

## Non-blocking packaging notes

1. go-hare Mach-O does **not** argv0-embed `rg` (sidecar) — intentional distribution choice
2. SEA-only mangled `N4Grep*` / reflex embed symbols are Bun link artifacts — **not** a JS port target
3. Optional `cwd` on `RipGrepOptions` covers densable spawn-cwd needs for product paths

## Non-claims

- Do **not** invent a JS pathological regex engine
- Do **not** downgrade vendor 15 → SEA 14
- Packaging difference alone does **not** demote HAVE under the GrepTool-visible product gate

## Board counts

HAVE **18** / PARTIAL **0** / GAP **0** / N/A **1** (#19)
