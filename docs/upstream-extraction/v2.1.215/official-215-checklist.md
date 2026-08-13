# densable 2.1.215 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.215 release notes（`CHANGELOG.upstream.md` / `changelog-2.1.215.md`）。  
> densable 二进制：`/tmp/official-215/plat/package/claude`（`npm pack @anthropic-ai/claude-code-darwin-arm64@2.1.215`，247 124 336 bytes）。  
> 基线：产品 **2.7.30** / densable **2.1.214 收口**（`official-214-checklist` 47/47 HAVE，git `fbe81e77`）。  
> 状态图例：**GAP** 未对齐 · **PARTIAL** 有半截 · **AUDIT** 需再判 · **HAVE** 已有 · **N/A** 不适用 · **LOW** 可选  
> 约定：**extract densable first → 1:1**，禁止简化版替代。KAIROS 不再加码。UDS/LAN/TEAMMEM pack 当时写默认 OFF — **2026-08-12 起 `DEFAULT_BUILD` ON**。  
> 本版 **仅 1 条**产品 changelog；勿把 216+ 混进本清单。

## 邻版关系

| 版 | 性质 | go-hare |
|----|------|---------|
| **2.1.214** | 大包（安全阀 + EndConversation + PS/Bash + bg daemon） | **已收口**（2.7.30） |
| **2.1.215** | 单点策略：`/verify` + `/code-review` 禁止模型自启 | **本清单** |
| **2.1.216+** | 长会话/sandbox/bg/Windows 等大包 | **另开 pack** |

---

## 全量对照（1 条官方 + 对照项）

| # | 官方条目 | 状态 | 本地备注 |
|---|----------|------|----------|
| 1 | **Claude 不再自行运行 `/verify` 与 `/code-review` skills**；需要时用户手动 `/verify` 或 `/code-review` | **HAVE** | 2026-08-06 densable 1:1：`disableModelInvocation: true` + `userInvocable: true` 落在 `src/commands/codeReview.ts`（`codeReview` only）与 `src/skills/bundled/verify.ts`。测试：`src/skills/bundled/__tests__/verify.disableModelInvocation.215.test.ts`。extract: `no-auto-verify-code-review.extract.md`。 |
| 1b | 对照：`/simplify` **不**加 `disableModelInvocation`（仍可被模型调用） | **HAVE** | densable `Hu({name:uzr, userInvocable:!0, …})` 无 disable 标志。本地 simplify 亦未 disable。对齐 215 时 **禁止**误改 simplify。 |
| 1c | 对照：ant `VERIFICATION_AGENT` system prompt（`tengu_hive_evidence`） | **N/A** | 官方 215 条目点名 **skills** `/verify`、`/code-review`，非 verification subagent。本清单不强制改 `prompts.ts`。 |

---

## 统计（pack 日 2026-08-06）

| 状态 | 条数 | 说明 |
|------|------|------|
| **HAVE** | **2** | #1 官方主条 + #1b simplify 对照 |
| **GAP** | **0** | — |
| **PARTIAL** | **0** | — |
| **N/A** | **1** | #1c verification agent |
| **AUDIT / LOW** | **0** | — |

> 2026-08-06 落地后：**HAVE 2 / GAP 0**（官方 1 条产品变更已 1:1）。

---

## densable 二进制证据（抽样）

| 符号 / 字符串 | 含义 |
|---------------|------|
| `Oye="code-review"`, `Mne="verify"`, `uzr="simplify"` | skill/command 名常量 |
| `disableModelInvocation:!0` on `Hu({name:Oye…})` / `Hu({name:Mne…})` | 禁止模型经 Skill 工具调用 |
| `userInvocable:!0` on same | 保留用户 `/` 调用 |
| `nnS="Verify that a code change…"` | verify description |
| `menuDescription:"Review the current diff for bugs and cleanups"` | code-review 菜单文案 |
| `disable-model-invocation: true`（skill 文档） | frontmatter 语义与 runtime 字段对应 |

---

## 推荐实施批次

### Batch 1 — 唯一批次（整版）

1. `code-review` → `disableModelInvocation: true`  
2. `verify` bundled skill → `disableModelInvocation: true`  
3. 测试 + checklist flip +（可选）极短 README 发布说明  

### 暂不默认开

- 2.1.216+  
- 非 ant 开放 `/verify`  
- 关掉 harness/ant verification agent 文案  
