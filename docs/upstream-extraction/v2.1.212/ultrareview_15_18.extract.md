# densable 2.1.212 — /ultrareview #15–18 extract

Source binary: `densable-212/package/claude.exe`

## Changelog (official)

- Fixed `/ultrareview` rejecting PR references like `#123`, `PR 123`, and pasted PR URLs; error hints now name the command you actually typed
- Fixed `/ultrareview <branch>` not fetching the branch from origin when it exists remotely; it now suggests the closest branch name on typos
- Fixed `/ultrareview` skipping the billing confirmation in a new conversation after `/clear`
- Fixed `/ultrareview`'s "not a git repository" error on Claude Desktop now suggesting the project's repository folder instead of terminal commands

## PR normalize (`yqr` + `YOo`)

```js
function yqr(e){
  let t=e.match(pMg);
  if(!t)return null;
  return{url:e,host:t[1],owner:t[2],repo:t[3],num:Number(t[4])}
}
pMg=/^https:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\b/

// YOo resolve:
let n=e.trim(),o=yqr(n),
  i=o?.num.toString()??n.match(/^(?:#|PR[\s#]*)(\d+)$/i)?.[1]??n;
if(/^\d+$/.test(i)){ /* PR mode with i */ }
// analytics when i!==n: pr_arg_normalization
// wrong-repo: That link is for ${owner}/${repo} on ${host}, but ...
// errors use invocation `t` (actual typed command), not hard-coded /ultrareview only
```

## Branch fetch + suggest (`YI_` / `XI_` / `nst`)

```js
async function YI_(e){
  if(e.startsWith("-")||e.includes(":")||/\s/.test(e))return"not_found";
  // ls-remote --heads --exit-code origin e (BatchMode, no credential helper)
  // if refs/heads/e present → fetch refs/heads/e:refs/remotes/origin/e
  // return recovered | fetch_failed | not_found | probe_failed
}
async function XI_(e){
  // for-each-ref refs/heads + refs/remotes/origin
  // main↔master swap first
  // else Damerau-Levenshtein nst threshold 3 → closest ref short name
}
function nst(e,t){ /* Damerau-Levenshtein */ }
```

Error copy when missing:

- fetch_failed: `"${n}" exists on origin but couldn't be fetched. Run \`git fetch origin ${n}\` and try ${t} again.`
- not_found: `"${n}" is not a branch in this repo.${Did you mean \`E\`?} ${t} takes a PR number...`

## Desktop not-git (`Ibp` / `WW` / `Ghl`)

```js
Ghl=new Set(["claude-desktop","claude-desktop-3p","local-agent"])
function WW(){
  let e=Z.CLAUDE_CODE_ENTRYPOINT;
  return e!==void 0&&Ghl.has(e)
}
function Ibp(){
  return WW()
    ?"Open your project's repository folder and try again."
    :'Run "git init" here to create a repository, or cd into an existing one.'
}
// not_git_repo:
`${t} needs a git repository so it can clone your code into a cloud sandbox, but ${Ct()} is not inside one. ${Ibp()}`
```

## Overage after `/clear` (`ultrareviewOverageConfirmed`)

```js
// AppState default:
ultrareviewOverageConfirmed:!1

function M6e(e){
  e((t)=>t.ultrareviewOverageConfirmed?t:{...t,ultrareviewOverageConfirmed:!0})
}
isUltrareviewOverageConfirmed:()=>i().ultrareviewOverageConfirmed
markUltrareviewOverageConfirmed:()=>M6e(s)

// /clear regenerates conversation → fresh AppState seed → false again
// (module-level flag would incorrectly survive /clear — that was the bug)
```

## Diff / pack size residual (YOo full precondition)

```js
// Fnt = Qe("tengu_review_bughunter_config", null)
function qqi(){
  let e=Fnt(), t=(r,n)=>typeof r==="number"&&Number.isFinite(r)&&r>0?Math.floor(r):n;
  return{maxFiles:t(e?.max_diff_files,500),maxLines:t(e?.max_diff_lines,8000)}
}
function Dro(e){
  let t=e.match(/(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/);
  if(!t)return null;
  return{filesCount:parseInt(t[1]??"0",10),linesAdded:parseInt(t[2]??"0",10),linesRemoved:parseInt(t[3]??"0",10)}
}
// H1g=104857600; XCu = Qe("tengu_ccr_bundle_max_bytes",null)??H1g
// JCu: git count-objects -v → size-pack KiB*1024, in-pack
// QCu: tooLarge = r>3*o && (r>100*o || n>5000000)
// PR: gh pr view --json additions,deletions,changedFiles → pr_diff_too_large
// monorepo: anthropics/anthropic on github host → monorepo_blocked
```

## Local mapping

| densable | local |
|----------|-------|
| `yqr` / `pMg` | `parseGithubPullUrl` in `reviewRemote.ts` |
| `YOo` PR normalize | `normalizeUltrareviewPrArg` + `launchRemoteReview` |
| `YI_` / `XI_` / `nst` | `tryFetchOriginBranch` / `suggestClosestBranch` / `damerauLevenshtein` |
| `Ibp` / `WW` / `Ghl` | `notGitRepoHint` / `isDesktopLikeEntrypoint` |
| `M6e` / AppState flag | `AppState.ultrareviewOverageConfirmed` + clear reset |
| `qqi` / `Dro` | `getUltrareviewDiffLimits` / `parseGitShortstat` |
| `QCu` / `JCu` / `XCu` / `H1g` | `probeRepoTooLargeToBundle` / `countGitPackObjects` / `getCcrBundleMaxBytes` |
| monorepo_blocked | `isAnthropicMonorepoBlocked` via densable `fm` |
| `kPr` / `KJe` / `fm` | `normalizeReviewHost` / `reviewHostsEqual` / `isGithubComHost` |
| pr_url_wrong_repo | URL + host/owner/repo 不匹配（含 no remote） |
| pr_diff_too_large | `gh pr view` in PR branch of `launchRemoteReview` |
| local_diff_too_large | Dro+qqi after shortstat |

## Host / wrong_repo residual (deep dig 2026-08-06)

densable `YOo` PR path:

```js
// E = KJe(o?.host,S?.host) || (!!o && !!S && fm(o.host) && fm(S.host))
// if (o && (!E || owner/repo mismatch)) → pr_url_wrong_repo
//   "That link is for ${owner}/${repo} on ${host}, but ${you're in… | this directory has no GitHub remote}."
// if (!S) → no_github_remote  (bare PR number only)
// monorepo: fm(S.host) && anthropics/anthropic
// NO hard gate `S.host === "github.com"` (GHE may continue with gh --repo)
// fm: kPr + strip www → === "github.com"
```

## YOo/JOo telemetry + launch residual (deep dig continued)

Full extracts: `ultrareview_fn_YOo.js`, `ultrareview_fn_JOo.js`

| densable | local |
|----------|-------|
| `hde()` | `isCwdHome` — `cwd_is_home` on precondition events |
| `reason: ke(...)` | `reason: meta(...)` (replaces only `precondition_errors` string bag) |
| base_ref diagnostics | `baseRefArgDiagnostics` + `has_remote` |
| pr_arg_normalization outcomes | `logPrArgRecovery(succeeded\|failed)` with reason/method/outcome |
| fetch_retry l(outcome) | only when YI_ recovered; after merge-base/empty/size |
| `Mru()` → `BUGHUNTER_MODEL` | from `tengu_review_bughunter_config.model` |
| `source:"ultrareview"` | `teleportToRemote({ source: 'ultrareview' })` |
| `tags:["ultrareview"]` | `teleportToRemote({ tags: ['ultrareview'] })` top-level CreateSession |
| `bundleBaseRef: mergeBaseSha` | `teleportToRemote({ bundleBaseRef })` → Jes/`createAndUploadGitBundle` `baseRef` |
| Qre explicit `onBundleFail` | only when `failReason !== 'too_large'`; raw Jes error string |
| Jes `x1g` baseRef squash | parent seed-base commit-tree; identical trees → `no_changes` |
| Jes stash hard-fail | `stash_failed` when HEAD ok + stash stderr |
| JOo branch fail copy | `onBundleFail` msg \|\| createFail \|\| **`Repo is too large.`** (short; QCu early keeps "to bundle") |
| JOo no_git_remote eligibility | ultrareview-specific gh create/push copy |
| `tengu_review_remote_launched` | `{ mode, had_arg }` |
| launch Scope line | branch mode appends `\nScope: ${diffStat}` |

## Qre/Jes residual (2026-08-06 adversarial)

Full extracts: `ultrareview_fn_Qre_teleport.js`, `ultrareview_fn_Jes_x1g_gitBundle.js`

```js
// JOo PR:  Qre({..., source:"ultrareview", tags:["ultrareview"], environmentId, branchName})
// JOo BR:  Qre({..., useBundle:!0, bundleBaseRef:L, tags:["ultrareview"], ...})
// Qre explicit: Jes({baseRef:e.bundleBaseRef}); failReason!=="too_large" → onBundleFail(error,"bundle")
// request: {session_context, ...Cqr(envId), ...e.tags&&{tags:e.tags}}
// x1g baseRef: rev-parse trees equal → no_changes; else commit-tree base^{tree} -m seed-base as -p
```
