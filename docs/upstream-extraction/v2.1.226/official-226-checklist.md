# densable 2.1.226 — 官方更新清单 × go-hare 对照

> 来源：官方 2.1.226 release notes（`changelog-2.1.226.md`，**1 条 opaque**）。  
> densable 二进制 SEA：`/tmp/official-226/plat/package/claude`（darwin-arm64）；`// Version: 2.1.226` HIT ×6；size **279661952**（与 2.1.225 **相同**）；sha256 `013a1cf17df5ff1dcc189d5d6fd3fdd5f097ddc3cd41aa9992e99805574febbe`。  
> 基线：本地 tip densable **2.1.225**（`814ff6dc`，HAVE 13/14）。**本 pack 只对齐 2.1.226**。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN** · **NOOP**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。不 invent cloud/VSCode-only。  
> 更新：2026-08-12 — SEA pack + 225↔226 字节/字符串对照完成。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.225** | gateway spend / agents trust / OAuth / RC pin / CCR tip 等 14 条 | tip `814ff6dc`（HAVE 13 · N/A 1 VSCode） |
| **2.1.226** | **单条 opaque**：「Bug fixes and reliability improvements」 | **本 pack** |
| **2.1.227+** | 5+18 条真实 bullet | 勿折入 |

## densable 关键符号（SEA 锚）

| 符号 / 字符串 | 含义 | 状态 |
| --- | --- | --- |
| `// Version: 2.1.226` (×6) | 版本锚 | HIT |
| `BUILD_TIME:"2026-08-08T00:42:40Z"` | 构建时间 | HIT（相对 225 的 `2026-08-07T19:37:58Z`） |
| `GIT_SHA:"e140b3281c1e8d834468889bd0a5c3fd2f15507c"` | 提交戳 | HIT（相对 225 的 `d4b76e8c…`） |
| 与 225 同 size | 无净增二进制体积 | **identical 279661952** |
| 双端 printable 逻辑差 | 产品行为变更 | **0**（stamp/metadata only） |

## 条目对照（1）

| # | 官方要点 | 判定 | 本地证据 / densable 金标 | 备注 |
| - | -------- | ---- | ------------------------ | ---- |
| 1 | Bug fixes and reliability improvements | **NOOP / N/A-product** | changelog 无具体 bullet；SEA size 与 225 完全一致；225→226 对齐 diff 后 dual-printable 窗口仅 `VERSION` / `BUILD_TIME` / `GIT_SHA` 戳与二进制元数据；**无新增用户可见文案、无新函数级产品逻辑可 1:1 落地** | 不 invent 行为；go-hare 保持 225 产品面即对齐本版公开说明 |

## 计数（2026-08-12）

| 状态 | 条数 | 条目 |
| ---- | ---- | ---- |
| **HAVE** | **0** | — |
| **NOOP** | **1** | **#1** opaque reliability stamp（无可实现产品 delta） |
| **PARTIAL** | **0** | — |
| **GAP** | **0** | — |
| **UNKNOWN** | **0** | 已 SEA 对照；opaque 条目不另开 UNKNOWN |
| **N/A** | **0** | — |

> 说明：将 #1 标 **NOOP** 而非 HAVE，是因为没有可验证的产品行为变更可声明「已实现」。保持 225 tip 即满足官方 226 公开范围（无额外功能清单）。

## 验证（本轮）

- `npm pack @anthropic-ai/claude-code-darwin-arm64@2.1.226` → SEA 落盘  
- size equal 225；sha 不同（stamp + 元数据）  
- `// Version: 2.1.226` ×6  
- dual-printable mismatch after version normalize → **logic=0**；msgs 全为 BUILD_TIME/GIT_SHA 窗口  
- 未改业务源码（无可 1:1 落地项）

## 明确不做

- **不 invent** 「reliability」具体修复点  
- 不把 **2.1.227 / 2.1.228** 折入本 pack  
- 不 commit / bump / push，除非用户明确要求  
- 不为 opaque 版本强行改 MACRO 版本号（bump 另议）

## 建议后续

1. **跳过 226 产品实现**，直接开 **2.1.227**（5 条可提取 bullet）或 **2.1.228**（18 条）  
2. 若需要版本号展示与 npm 对齐，另开 `chore: bump displayed version to 2.1.226`（非功能 pack）  
3. commit 本目录 extract 文档（可选）

## SEA 工件

```
/tmp/official-226/plat/package/claude
/tmp/official-226/sha256.txt
/tmp/official-226/plat/anthropic-ai-claude-code-darwin-arm64-2.1.226.tgz
docs/upstream-extraction/v2.1.226/snippets/sea-meta.txt
docs/upstream-extraction/v2.1.226/changelog-2.1.226.md
docs/upstream-extraction/v2.1.226/official-226-checklist.md
```
