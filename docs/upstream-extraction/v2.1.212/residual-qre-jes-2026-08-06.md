# densable 2.1.212 residual — Qre/Jes/eHu/ZCu + peripheral APIs (2026-08-06)

## 发现

对抗复审 212 全清单后，#15–18 产品路径仍有 **teleport explicit-env** 与 densable **Qre/Jes** 不对齐。后续补全 Qre 全臂、ZCu、pool/FZt、catch/monorepo/cwd，以及 **H8/F1g**。细枝 list/poll/send/update/mark_read/presence 在 densable 走 **`/v1/code/sessions`**（create 仍 tHu `"v1"`）。

**全面审查（同日）** 又确认并落地：
- H8/F1g token 必须用 **o9t**（非仅 keychain）
- 缺 densable **nts awaitRemoteSessionResult** export（workflow_remote_agent 调用面）
- `prepareApiRequest` **不能**硬塞 J7 的 first-party 门禁（本地被 usageCredits/referral 等共享）；门禁放在 session API 上

## densable 权威

| 符号 | 行为 |
|------|------|
| Qre create | tHu `"v1"` → `POST /v1/sessions` + beta + org |
| H8 archive | first-party；`o9t`；`POST /v1/code/sessions/{id}/archive`；Px only；bool；409=ok |
| F1g interrupt | first-party；`o9t`；Kj；Bit→BZt；beta+org+optional trusted；bool |
| OTe poll | first-party；N_ refresh；`o9t`；`GET /v1/code/sessions/{id}/events`；`sort_order+cursor`；payload unwrap；`metadataFetchError` |
| KLc/$Ur send | first-party；`POST …/events` `{events:[{payload}]}`；`{ok,reason?}` |
| l3e fetch | first-party；`GET /v1/code/sessions/{id}`；`response_shape??session`→zLc |
| $Ni list | J7；`GET /v1/code/sessions`；status=`archived?archived:worker_status??idle` |
| UNi/BNi/FUr | PUT title / mark_read / presence on code/sessions |
| Px | Bearer + Content-Type + anthropic-version + **anthropic-client-platform** (tP) |
| o9t | keychain ?? (CLAUDE_CODE_REMOTE ? OAUTH_TOKEN \|\| ile() : void) |
| nts await | poll OTe 1s；30min；idle×5 quiet；metadata miss×10；requires_action throw；archived/stable idle done |
| J7 | densable teleport-only first-party；本地 prepareApiRequest 共享故门禁下沉到 session 函数 |

## 本地落地

| 文件 | 变更 |
|------|------|
| `src/utils/teleport.tsx` | Qre 全臂；H8/F1g **o9t**；OTe poll；**awaitRemoteSessionResult (nts)** |
| `src/utils/teleport/api.ts` | $Ni/l3e/KLc/$Ur/UNi/BNi/FUr/Px/o9t/zLc/tP；session 级 first-party；prepareApiRequest 无 first-party 硬门 |
| `src/remote/RemoteSessionManager.ts` | sendMessage → `{ok,reason?}` |
| `src/hooks/useRemoteSession.ts` | 消费 `.ok` |
| leaf: pool/gitBundle/environments/preconditions/config/detectRepository/reviewRemote | 既有 1:1 |

## 验证

- `NODE_OPTIONS=--max-old-space-size=8192 bunx tsc --noEmit` → EXIT:0
- focused tests：teleport/api/ultrareview 单独 pass；与 autofix 同进程 mock 污染为 pre-existing

## 结论表

| # | 项 | 状态 |
|---|-----|------|
| 1–9 | eHu / auth / Qre 全臂 / ZCu / catch / monorepo / context / H8 / F1g | **已 1:1** |
| 10 | OTe poll code/sessions | **已 1:1** |
| 11 | KLc/$Ur send payload + `{ok}` | **已 1:1** |
| 12 | l3e/$Ni list+fetch | **已 1:1** |
| 13 | UNi/BNi/FUr | **已 1:1** |
| 14 | Px + tP + o9t | **已 1:1** |
| 15 | H8/F1g 用 o9t | **已 1:1**（审查补） |
| 16 | nts awaitRemoteSessionResult | **已 1:1**（审查补 export） |
| 17 | prepareApiRequest 共享 vs J7 first-party | **故意分流**（session 函数 gate；共享 prepare 不 gate） |

## 故意不扩 / 已知非 Qre 残留

- UDS/LAN/TEAMMEM OFF；KAIROS 不动；不混 214 EndConversation
- create 硬 `/v1/sessions`；周边 `/v1/code/sessions`
- kill 走 H8 archive；F1g 为导出 API
- CLI `--project/--ref/--on-branch`：densable 主 CLI 无字面 option 注册；**rts 中间层** 传 options。本地 options 就绪；**不发明** main flag
- densable ultraplan 仍检查 `requires_action`（worker_status 可返回）；zLc 用 worker_status 原样 — 本地一致
- densable workflow_remote_agent 调 nts；本地已 export，workflow 接线若未启用属产品开关
- RSM densable 另有 sendBashCommand + metrics — API 已 export；metrics 未强绑
- SessionStatus TS 联合仍含 legacy `running`；runtime 以 worker_status 字符串为准（densable 同样不强收窄）

extract: OTe/KLc/l3e/$Ni/H8/F1g/nts/Px/o9t/zLc 自 densable-212 binary
