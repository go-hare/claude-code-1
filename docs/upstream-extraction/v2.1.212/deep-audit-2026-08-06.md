# densable 2.1.212 全量深挖审计（2026-08-06）

## 范围

官方 changelog 48 条 → checklist 45 行（#15–18 合并、#24/#39 随 #1、#48 N/A）。  
对抗源：`densable-212/package/claude.exe` 字符串/函数提取 + 本地符号/文案/遥测对照。

## 结论

| 状态 | 数量 |
|------|------|
| **HAVE** | **44** |
| **N/A** | **1**（#48 文档勘误） |
| **GAP / PARTIAL（checklist）** | **0** |

`pack-report.md` 第三节历史 GAP 表已标 **STALE**，以 `official-212-checklist.md` 为准。

## 本轮真正改代码的 residual（仅 ultrareview）

对照 densable **`YOo` + `JOo` 全文**（`ultrareview_fn_YOo.js` / `ultrareview_fn_JOo.js`）：

### 行为 / 文案

1. **`kPr` / `KJe` / `fm`** — host 规范化；monorepo 仅 `github.com`（strip `www.`），非 `*.github.com` 后缀。
2. **`pr_url_wrong_repo`** — URL 在无 remote 时也走 wrong_repo；文案含 `this directory has no GitHub remote`。
3. **去掉硬闸 `host === 'github.com' → null`** — densable 允许 GHE 继续 `gh pr view --repo`。
4. **JOo branch teleport 失败** — 短文案 **`Repo is too large.`**（QCu early 仍为 `Repo is too large to bundle.`）；优先 `onBundleFail` / createFail。
5. **eligibility `no_git_remote`** — ultrareview 专用 gh create/push 文案。
6. **`source: 'ultrareview'`** + optional **`BUGHUNTER_MODEL`** from GB config.model。
7. **launch 成功** — analytics `{ mode, had_arg }`；branch 模式可附 `\nScope: ${diffStat}`。

### 遥测（densable 1:1 字段）

- `reason` + `cwd_is_home`（`isCwdHome` ≈ densable `hde`）
- `pack_bytes` / `pack_objects` on `repo_too_large_to_bundle`
- `files` / `lines` / `max_files` / `max_lines` on size fails
- `base_ref_not_found` 诊断：`looks_like_url|sha|starts_with_hash|has_slash|has_whitespace|has_remote`
- recovery：`pr_arg_normalization` / `fetch_retry` / `branch_suggestion` 带 `reason`+`method`+`outcome`
- YI_ recovered 后 merge-base/empty/size 路径再打 `fetch_retry` outcome

### 验证

- `bun test src/commands/review/__tests__/reviewRemote.normalize.test.ts` → **31 pass / 0 fail**
- `tsc --noEmit` → **EXIT:0**

## 其它簇对抗（未改代码）

| 簇 | 抽查 | 结果 |
|----|------|------|
| Fork / subtask | keepParent, spawnBackgroundSessionFork, /subtask | HAVE |
| Caps / MCP | sessionSpawnCaps, mcp client auto-bg | HAVE |
| print SIGTERM 143 | print.ts `gracefulShutdown(143)` + ShellCommand timeout143 | HAVE |
| Auth 标题 | AwsAuthStatusBox `Authentication` | HAVE |
| midConv / OTel / 529 / Needs input / forceLogin / Jd / ctrl+j | 符号命中 | HAVE |
| 210 collapsed tool elapsed | 旁注 PARTIAL | **不在 212 官方 48 条** |

## 故意不扩的边角

- densable analytics 里部分 `be()`/`Xo()` 服务器 fail 细节字段（status_code/server_type）— teleport 回调未全量透传，用户可见路径已 1:1。
- UDS_INBOX / LAN_PIPES / TEAMMEM 默认 OFF；KAIROS 不动。
- 不混入 2.1.214 EndConversation。

## 文件

- 代码：`src/commands/review/reviewRemote.ts` + normalize tests
- extract：`ultrareview_15_18.extract.md`、`ultrareview_fn_YOo.js`、`ultrareview_fn_JOo.js`
- checklist 行 15–18 已更新 note
