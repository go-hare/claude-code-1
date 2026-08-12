# densable 2.1.223 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.223 release notes（`changelog-2.1.223.md`，**19 条**）。  
> densable 二进制 SEA：`/tmp/official-223/plat/package/claude`（darwin-arm64）；`// Version: 2.1.223` HIT ×6；size **272553824**；sha256 `fcbe0b8d47570c501302dd1ad31cc26ac2810f022c45fa253936a6961dee32bf`。  
> 基线：本地 tip 含 densable **2.1.222** 收口 + npm **2.7.36**；**本 pack 只对齐 2.1.223**。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。  
> 更新：2026-08-11 — 三波 + adversarial 闭环 + #14 深 sanitize：#4/#15 HAVE；#5 Bash/PS + Monitor eHe/Jg + DRd code-point；#8 resume hydrate；#14 `sanitizeDiagnosticFiles` SEA 1:1（range.start 数字门 / severity map / dual gold）。  
> 计数：**HAVE 18 · PARTIAL 0 · GAP 1 · N/A 0 · UNKNOWN 0**（19）。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.222** | worktree isolation / SendMessage classifier / RC auto-start / ultraplan remove 等 21 条 | **已收口**（2.7.36） |
| **2.1.223** | owner/* marketplace / agent bypass org / diagnostics resume / /review alias 等 19 条 | **本 pack** |
| **2.1.224+** | 勿折入 | — |

## densable 关键符号（SEA 锚）

| 符号 / 字符串 | 含义 | 状态 |
| --- | --- | --- |
| `// Version: 2.1.223` (×6) | 版本锚 | HIT |
| `{"source":"github","repo":"owner/*"}` / `Invalid owner-wildcard repo` | #1 F4u/MEo/B4u/U4u/DEo | LANDED |
| `codeReviewLastEffort` / `reusing ${n}, the level the user typed last time` | #19 | LANDED |
| `Subagent declared permissionMode: bypassPermissions but this session is not running in a contained no-internet environment` | #7 | LANDED |
| `Dropped … malformed diagnostic(s) from a replayed diagnostics attachment` | #14 | LANDED |
| `import()` workflow sandbox block | #6 | HAVE (prior) |
| `Subagent model "…" is not in the availableModels allowlist; using the newest allowed model in its family / inheriting the parent model instead` | #2 | HAVE (`agent.ts` warn) |
| `/(claude\|anthropic)/i.test(d.id)` gateway filter | #9 | LANDED |
| `mergeManagedEnvPerKey` / server + machine-local env | #11 | LANDED |
| `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` | #17 | LANDED |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT` 扩到 native 1M 全量 + startup warn | #16 | LANDED |
| teleport local continue hint | #3 | GAP（无 cloud session 面不假造） |
| ENt A_s/I_s/R_s / `Contains zsh <N-M> numeric-range glob` | #4 | LANDED |
| xRd/eHe/IRd/Jg TAB→⇥ display | #5 | LANDED |
| cHt(relocated,relocatedCwd) / resume after /cd | #8 | LANDED |
| git push `[0-9a-f]+\.+[0-9a-f]+` (no hang) | #15 | LANDED |

证据：`snippets/hit-*-gold.txt`、`snippets/sea-meta.txt`、`changelog-2.1.223.md`。

## 全量对照（19 条）

| # | 官方条目（摘要） | 状态 | 本地备注 |
| --- | --- | --- | --- |
| 1 | `strictKnownMarketplaces` / `blockedMarketplaces` 支持 github `owner/*` | **HAVE** | densable F4u/MEo/B4u/U4u/DEo → `githubRepoPolicyMatches` + `areSourcesEqual` / blocklist cross github↔git。settings describe 对齐 SEA 文案。测试：`ownerWildcard.223.test.ts`。 |
| 2 | workflow / forked skill / slash / resumed bg agent 请求的 subagent model 被限制时警告（跑 parent） | **HAVE** | `src/utils/model/agent.ts` `warnSubagentModelNotAllowed` densable 金句；`resolveWhenNotAllowed` / `getAgentModel` 全路径覆盖 env/tool/frontmatter/family step-down。测试：`agentFamilyStepDown.222.test.ts`。 |
| 3 | cloud session `/teleport` hint：本地 `claude --teleport <session id>` | **GAP** | SEA 有 teleport hint 金句；本地无 cloud session 提示产品面 — **不假造**。 |
| 4 | Bash permission bypass：crafted command 隐藏部分自身 | **HAVE** | SEA ENt pre-checks 1:1：A_s lone surrogate · R_s · I_s `<N-M>` · 全 differential:true。测试：`bashHide.223.test.ts`。证据：`hit-bash-hide-gold.txt`。 |
| 5 | permission prompt：tab / invisible Unicode 不能隐藏命令 | **HAVE** | eHe schema C0/C1 only；display Jg/DRd code-point + TAB→⇥；Bash/PS/Monitor schema refine + UI `replaceHiddenControlChars`。测试：`controlChars.223.test.ts`。证据：`hit-invisible-cmd-gold.txt`。 |
| 6 | workflow 禁止 dynamic `import()` 逃出 sandbox | **HAVE** | `assertScriptBody` 已拦 `import(`。证据：`hit-workflow-import-gold.txt`。 |
| 7 | agent 定义 `bypassPermissions` 忽略 org disable 策略 | **HAVE** | `runAgent`：`isBypassPermissionsModeDisabled() \|\| !isBypassPermissionsModeAvailable` 时丢弃 agent bypass，log densable 金句。测试：`agentBypassOrgPolicy.223.test.ts`。 |
| 8 | mid-session `/cd` 后 resume 空会话 | **HAVE** | tNt 既有 + lite/full load 读 `relocated` stamp（cHt）；`loadConversationForResume`/`loadMessagesFromJsonlPath` 透传 `relocatedCwd` → `restoreSessionMetadata`；no-leaf `loadFullLog` 也 hydrate。测试：`resumeAfterCd.223.test.ts`。证据：`hit-resume-cd-gold.txt`。 |
| 9 | gateway 前缀模型 ID（`vertex_ai/claude-*` / `bedrock/anthropic.claude-*`）被隐藏 | **HAVE** | SEA `/(claude\|anthropic)/i.test(d.id)` → `isGatewayUsableModelId` + `planGatewayModelsCacheWrite` / `parseGatewayModelOptionsFromCache`。测试：`gatewayPrefixed.223.test.ts`。 |
| 10 | `modelOverrides` 非 Anthropic ID key 不应成为 session canonical model | **HAVE** | 既有 overrides 校验/忽略未知 key 路径（与文档一致）；保持。 |
| 11 | managed settings：server 下发不再禁用本机 managed-settings/MDM 的 env；admin env **per-key merge** | **HAVE** | `mergeManagedEnvPerKey` + `resolvePolicySettingsWithEnvMerge`：字段 first-source-wins，env 跨 remote/MDM/file/hkcu per-key merge。测试：`managedEnvMerge.223.test.ts`。 |
| 12 | Linux sandbox `denyWrite` 覆盖 cwd 时命令起不来 | **HAVE** | 依赖 sandbox-runtime / denyWrite 行为；SEA `hit-denywrite-linux-gold.txt`。 |
| 13 | forked bg agent rebuild parent prompt 失败后整 session “already resuming” | **HAVE** | 既有 already-resuming 复位路径。 |
| 14 | resume 历史含 malformed diagnostics attachment 导致每 turn 失败 / 无响应错误屏 | **HAVE** | densable `sanitizeDiagnosticFiles` 1:1（`DiagnosticTrackingService`）：non-array → `Dropped a missing\|non-array…`；per-diag `message`+`range.start.line/character` number 门；`Ruy` severity map；end 缺省→start；双金句 dedupe。`messages.ts` case diagnostics 只调 sanitize+format。测试：`malformedDiagnostics.223.test.ts`。 |
| 15 | 解析异常 `git push` 输出罕见 hang | **HAVE** | SEA hex-only range regex；pathological non-hex <50ms。测试：`gitPushParse.223.test.ts`。证据：`hit-git-push-parse-gold.txt`。 |
| 16 | `CLAUDE_CODE_DISABLE_1M_CONTEXT` 约束所有 native 1M 窗口模型到 200K（非固定名单）+ 启动警告 | **HAVE** | `applyDisable1mClamp` 对 capability/[1m]/beta/ant 全路径 >200K clamp；`modelSupports1M` 扩 opus-5/fable；`getDisable1mContextNotEnforcedWarning` + sessionStart log。测试：`contextWindow.223.test.ts`。 |
| 17 | 未知 model ID 也做 auto-compact 窗口 enforcement；`CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` 可关 | **HAVE** | `isRecognizedModelForWindowEnforcement` + assumed 200K；env 关 → `UNKNOWN_MODEL_WAIT_FOR_API_WINDOW`；startup notice 金句。测试：`contextWindow.223.test.ts`。 |
| 18 | `/review` 变为 `/code-review` 的 alias | **HAVE** | `codeReview.aliases=['review']`；legacy `review.ts` `isHidden: true`。测试：`codeReview.223.test.ts`。 |
| 19 | `/code-review` 无 effort 时复用上次键入的 level（`codeReviewLastEffort`） | **HAVE** | GlobalConfig `codeReviewLastEffort`；`parseCodeReviewArgs(lastEffort)` + `rememberCodeReviewEffort` + densable notice。测试：`codeReview.223.test.ts`。 |

## 故意不扩 / 站位

| 项 | 策略 |
| -- | ---- |
| invent N9 remote effort | 无协议不硬塞 |
| #3 teleport cloud hint | 无 cloud session 产品面不假造 |
| UDS_INBOX / LAN_PIPES / TEAMMEM / KAIROS 外围 | 历史：本 pack 时 go-hare 默认 OFF。**2026-08-12 起** `DEFAULT_BUILD_FEATURES` 已 ON（见 228 checklist Feature 默认节） |

## 优先落地顺序（剩余）

1. #3 teleport hint（仅当接上 cloud session 面 — **不假造**）

## 证据文件

- `changelog-2.1.223.md`
- `snippets/sea-meta.txt` / `snippets/hit-version-2.1.223.txt`
- `snippets/hit-owner-wildcard-gold.txt`
- `snippets/hit-bypass-subagent-gold.txt`
- `snippets/hit-code-review-gold.txt`
- `snippets/hit-workflow-import-gold.txt`
- `snippets/hit-1m-unknown-window-gold.txt`
- `snippets/hit-denywrite-linux-gold.txt`
- `snippets/hit-teleport-hint-gold.txt`
- `snippets/hit-bash-hide-gold.txt`
- `snippets/hit-invisible-cmd-gold.txt`
- `snippets/hit-resume-cd-gold.txt`
- `snippets/hit-git-push-parse-gold.txt`
- `snippets/hit-gateway-filter-gold.txt`
- `src/utils/plugins/__tests__/ownerWildcard.223.test.ts`
- `src/utils/__tests__/malformedDiagnostics.223.test.ts`
- `src/commands/__tests__/codeReview.223.test.ts`
- `packages/builtin-tools/src/tools/AgentTool/__tests__/agentBypassOrgPolicy.223.test.ts`
- `src/utils/__tests__/contextWindow.223.test.ts`
- `src/utils/__tests__/gatewayPrefixed.223.test.ts`
- `src/utils/settings/__tests__/managedEnvMerge.223.test.ts`
- `src/utils/bash/__tests__/bashHide.223.test.ts`
- `src/utils/__tests__/controlChars.223.test.ts`
- `src/utils/__tests__/resumeAfterCd.223.test.ts`
- `packages/builtin-tools/src/tools/shared/__tests__/gitPushParse.223.test.ts`
