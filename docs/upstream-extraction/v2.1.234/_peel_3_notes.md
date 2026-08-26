# #3 GitLab MR badge — peel notes (densable 2.1.234)

## SEA gold

- `_pp(e)`: git check → branch!=default → `(Iya()?yWb:pWb)() ?? lpp(e)`
- `Iya()` = GrowthBook `tengu_harbor_prism` default false — **not enabled**; local keeps `pWb` only (invent-ban)
- `lpp` = glab `mr view -F json` with:
  - `ia()` essential-traffic gate
  - `gge("glab")` / whichSync
  - `iWb()` remote host; skip `wCt(host)==="github"`
  - unauth host Set + `opp` regex
  - strip `GITLAB_TOKEN` / `GITLAB_ACCESS_TOKEN` / `OAUTH_TOKEN` (void 0)
  - timeout `nWb=2500`
  - `aWb` web_url regex + iid; `lWb` state map; `kind:"mr"`
  - `_e("gitlab_mr_badge")` once / `pe` on bad
- `eQo` returns string `"fetch-failed"` for densable poller bad_streak; local maps to null + feature_bad (legacy usePrStatus has no string union — same hide badge outcome)
- GitHub `pWb` return has **no** `kind` field

## Local

- `src/utils/ghPrStatus.ts` — `fetchGitlabMrStatus` + `fetchPrStatus` fallback
- `PrBadge` already uses `!N` via URL provider
- tests: `ghPrStatus.234.test.ts` (lWb/aWb)

## Intentionally not ported

- `yWb` / harbor_prism direct GitHub API token path
- densable WeakMap session keyed by ink `host` object — local process singleton token
