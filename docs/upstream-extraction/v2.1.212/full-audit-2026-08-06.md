# densable 2.1.212 全面审查报告（2026-08-06）

## 范围与方法

| 项 | 值 |
|----|-----|
| 官方 changelog | 48 bullets（`changelog-2.1.212.md`） |
| checklist 行 | 45（#15–18 合并；#24/#39 随 #1；#48 N/A） |
| densable 二进制 | `densable-212/package/claude.exe` 字符串/函数抽查 |
| 本地扫描 | `src/` + `packages/` **3729** 个 ts/tsx；45 组关键符号探针 |
| 精确抽查 | caps 默认、MCP 120s wire、ultrareview overage、#27–29 UI、#41 footer、#42 mode、#47 Auth |

## 总表

| 状态 | 数量 | 说明 |
|------|------|------|
| **HAVE** | **44** | 官方产品条目均有 1:1 落地 |
| **N/A** | **1** | #48 文档勘误（tmux 3.6） |
| **GAP** | **0** | |
| **PARTIAL（checklist）** | **0** | |

本地符号矩阵：**MISS count 0**。

## 官方 48 条 ↔ checklist 覆盖

- changelog 每条 bullet 均可映射到 checklist 行（合并规则见上）。
- 无「changelog 有、checklist 无」的遗漏条目。
- 无「checklist HAVE 但本地关键符号缺失」的假阳性（本轮 45 探针全 OK）。

## 分簇结论（对抗）

| 簇 | # | 关键证据 | 结论 |
|----|---|----------|------|
| Fork/subtask | 1,24,39 | `spawnBackgroundSessionFork` keepParent / `forkSourceAlive` / `/subtask` / `deriveForkName` | HAVE |
| Caps/MCP | 3–5 | `sessionSpawnCaps` 200/200；`mcpAutoBackground` 120s + `client.ts` `resolveMcpAutoBackgroundMs` | HAVE |
| Agents UX | 6,25,37,41,46 | openResumePicker；xyr/xSe/uqArgvPeel；attachTranscriptPreview；AgentsFooterHint fpf；Needs input / JFa | HAVE |
| 安全权限可靠 | 7–12,20–23,26,30–36,38,42–45 | plan floor、symlink guard、hooks halt、SIGTERM143、PS7、bash-path、partial read、worktree resume、RC grid、control_request、idle、OTel、529、midConv、SendMessage preview、mode deprecated、effort、set_model | HAVE |
| LOW UI | 13–14,27–29,47 | Jd；ctrl+j；KeyboardShortcutHint；OffscreenFreeze pureCheck；gutter flexShrink0；Authentication | HAVE |
| Ultrareview | 15–18 | YOo/JOo 全量预检+host+telemetry+overage AppState+/clear | HAVE |
| Enterprise | 43 | forceLoginMethod + GatewayConnect OIDC | HAVE |
| Hosted | 19 | host-managed mTLS/CA/OAuth strip | HAVE |
| 文档 | 48 | 勘误 | N/A |

## 精确抽查（防「字符串碰巧命中」）

| # | 抽查点 | 结果 |
|---|--------|------|
| 3–4 | `DEFAULT_MAX_* = 200` densable qpg/zpg | 命中 `sessionSpawnCaps.ts` |
| 5 | 默认 120_000 + client wire | `DEFAULT_MCP_AUTO_BACKGROUND_MS` + `mcp/client.ts:2085` |
| 15–18 | overage AppState + /clear 重置 | main/AppStateStore/clear/ultrareviewCommand 全链路 |
| 27 | ExitPlanMode `KeyboardShortcutHint` ctrl+g | 命中 |
| 28 | OffscreenFreeze pureCheck + columns/rows | 命中 |
| 29 | StructuredDiff `NoSelect fromLeftEdge flexShrink={0}` | 命中 |
| 41 | `AgentsFooterHint` fpf / Ozo=2500ms | 命中 footer left side |
| 42 | AgentTool `void` deprecated mode + inherit parent | 命中 |
| 47 | AwsAuthStatusBox 标题 `Authentication` | 命中（非 Cloud authentication） |

## extract 文档

`docs/upstream-extraction/v2.1.212/` 下 **41** 个 `*.extract.md`，覆盖主要落地簇。  
ultrareview 额外有 `ultrareview_fn_YOo.js` / `JOo.js` 全文提取。

## 文档债务（非产品 GAP）

1. **`pack-report.md` 第三节** — 已标 STALE；历史 GAP 勿当现状。
2. densable 遥测细字段（如部分 server fail `status_code`/`server_type`）— 用户路径已对齐，可选抛光。
3. **210 邻接** collapsed tool live elapsed — 不在 212 官方 48 条内。

## 故意范围外

- UDS_INBOX / LAN_PIPES / TEAMMEM 默认 OFF  
- KAIROS 不再动代码  
- 不混入 2.1.214 EndConversation  

## 结论

**全面审查：官方 2.1.212 从第 1 条到最后一条，checklist 无遗漏、无 GAP/PARTIAL 行；本地关键实现矩阵 0 MISS。**  
本轮未发现新的必须改代码 residual（ultrareview YOo/JOo 深挖 residual 已在同日前置回合收口）。
