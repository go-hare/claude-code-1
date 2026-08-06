# densable 2.1.214 Batch E — #35 ultrareview no_merge_base empty-tree fallback

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

无 merge-base（无关历史 / base 缺失）时，旧路径直接失败。densable 在 **非 shallow + HEAD 存在 + GB 未关** 时，用 empty tree 审查「全部 tracked files」。

## densable 证据

```
IXs = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"  // EMPTY_TREE_SHA
Wau() = Uot()?.empty_tree_fallback_enabled !== false  // default ON
Uot() = et(Bau,null)  // tengu_review_bughunter_config

// Z$o precheck — after merge-base fail:
if (HEAD ok && !shallow && Wau()) {
  R = arg || origin/base || base resolves
  shortstat vs IXs
  empty → empty_diff
  too large → local_diff_too_large after_fallback + "first review of entire repository"
  else recovery offered empty_tree_bundle
  return ok scope { mergeBaseSha:IXs, noMergeBase: R?"unrelated_history":"base_ref_missing" }
}
// else fail: no commits / shallow deepen_hint / Could not find merge-base

// tFo launch branch:
bundleForceScope: noMergeBase ? "squashed" : undefined
bundleBaseRef: mergeBaseSha  // IXs when fallback
target: unrelated → `${head} (all files — no common history with ${base})`
        missing  → `${head} (all files)`
recovery succeeded → no_merge_base_empty_tree_fallback
```

gitBundle forceScope=squashed：跳过 --all/HEAD，仅 squashed-root（仍受 size skipSquash 门闩）。

## 本地落地

| densable | 本地 |
|----------|------|
| `IXs` / `Wau` | `EMPTY_TREE_SHA` / `isEmptyTreeFallbackEnabled` in `reviewRemote.ts` |
| Z$o empty-tree path | `launchRemoteReview` merge-base fail 分支 |
| tFo forceScope + labels | `teleportToRemote({ bundleForceScope:'squashed', bundleBaseRef:EMPTY_TREE })` |
| Jes forceScope | `createAndUploadGitBundle` / `_bundleWithFallback` |

测试：`reviewRemote.normalize.test.ts`（IXs/Wau 常量契约）

## 状态

- **#35 HAVE**
