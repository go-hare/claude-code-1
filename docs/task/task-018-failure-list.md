# precheck 失败清单（junit 重扫 2026-09-16 full5）

由 `bun test --reporter=junit` 全量与逐文件单独跑严格比对生成。

| | 数量 | 性质 |
|---|---|---|
| 全量失败用例 | **0** | — |
| 单独跑仍失败 | **0** | — |
| 单独跑转为通过（历史隔离） | 已清 | 顺序 / 测试隔离已修 |

> 产物在 `tmp-junit/`（`full5.xml` / `full5-console.txt`）。

## 全量摘要（full5）

```
15242 pass
4 skip
0 fail
Ran 15248 tests across 1614 files
```

## 本轮隔离污染修复要点

| 污染源 | 受害者 | 修复 |
|--------|--------|------|
| `sandbox.filesystem.disabled` 未还原 `getPlatform` | pathQuoteChars / inputRedirect / UNC withhold | afterAll 还原真实 platform |
| `claudeCodeBackend` 未还原 `finalizeAgentTool` | maxTurnsPartial | snapshot + afterAll 还原 AgentTool mocks |
| `growthbookMock` 缺 env pin | growthbookOrgEnv | mock 对齐真实 Qf env fallback |
| `getProjectPathForConfig` memo + `/cd` relocate | headersHelper trust | cd afterEach clear memo；headersHelper beforeEach 对齐 cwd |
| `autonomyPersistence` 无-op lock 未还原 | wifCredentialRace | afterAll 还原 lockfile |
| `ultrareview*` `execFileNoThrowWithCwd→code:1` 未还原 | recon.239 git remotes | snapshot + afterAll 还原 exec |
| `envUtils` `/tmp/claude-home` 钉死 | agentTeamsLifecycle | 套件内重绑 + getTeamFilePath |
| `vertexWithRetryCap` sleep 未还原 | （潜在） | afterAll 还原 sleep |
| `trailingSlash` 依赖 Windows 上 macos 泄漏 | 自身 alone-red | 显式 mock macos（densable Mmr） |
| ScheduleWakeup sticky Cfr / GB | ScheduleWakeup | schema 恒带 optional noop；live Cfr；beforeEach 重装 GB mock |

旧快照：48→32（sessionProjectDir）→6（full3）→2（full4）→**0（full5）**。
