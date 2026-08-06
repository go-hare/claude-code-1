# densable 2.1.214 Batch E — #42 MCP prompts/resources list_changed keep previous

> densable 二进制：`%TEMP%/official-214/package/claude.exe`（2.1.214）  
> 约定：extract first → 1:1；无简化版。

## 问题

`prompts/list_changed` / `resources/list_changed` 瞬时失败时，旧路径把 commands/resources 刷成空 → slash 命令/资源闪断。

## densable 证据

```
Received prompts/list_changed notification, refreshing prompts
[mcp] ${name}: prompts/list_changed refresh failed (${err}); keeping previous commands

Received resources/list_changed notification, refreshing resources
[mcp] ${name}: resources/list_changed refresh partial failure (${err}); keeping previous for failed fields

Failed to refresh prompts after list_changed notification: …
Failed to refresh resources after list_changed notification: …
```

prompts：失败 **整表保留** previous commands。  
resources（含 skills 联刷）：**字段级** allSettled — 成功字段更新，失败字段保留 previous。

## 本地落地

| densable | 本地 |
|----------|------|
| keep previous commands | `resolvePromptsListChangedRefresh` + handler 不 updateServer on throw |
| partial keep fields | `resolveResourcesListChangedRefresh` + `Promise.allSettled` |
| warn copy | `formatListChangedRefreshFailed` |
| fetch soft-[] 会缓存空 | `fetchCommandsForClient` / `fetchResourcesForClient` **rethrow**；初连 `settleEmpty` |

测试：`mcpListChangedRefresh.214.test.ts`

## 状态

- **#42 HAVE**
