# #8 bg subagent 权限答案 session-scope 丢失 — notes

## Gold (densable 2.1.234 SEA)

- `y8r(setAppState)`：`setToolPermissionContext` 与 `setSessionToolPermissionContext` **同一** functional updater → `toolPermissionContext`
- `createSubagentContext`：`!shareSetAppState` 时 `setToolPermissionContext` noop；**始终**继承 parent `setSessionToolPermissionContext`
- `m4n.persistPermissions(d)`：
  - disk `zAe(d)`
  - 有 7th override `s` → `s(Bie(Ina(un(r)), d))`（teammate / leader bridge）
  - 否则 `r.setSessionToolPermissionContext(p => Bie(p,d))` + `setImmediate(() => n3e.emit())`
- `Bie` = applyPermissionUpdates；`Ina` = restoreDangerousPermissions；`Fna` = local|user|project settings
- Main REPL `m4n(...)` **不传** 7th override → session setter 路径
- 「including denies」= session destination 的 deny **rules**（addRules behavior deny）必须经 session setter 落到 parent AppState；纯 reject UI 本身不 persist

## Local

| Piece | Path |
|-------|------|
| y8r | `src/utils/permissions/permissionContextSetters.ts` |
| n3e | `src/utils/permissions/permissionRecheck.ts` |
| ToolUseContext fields | `src/Tool.ts` |
| createSubagentContext inherit | `src/utils/forkedAgent.ts` |
| m4n persist | `src/hooks/toolPermission/PermissionContext.ts` |
| REPL no override + n3e subscribe | `src/screens/REPL.tsx` / `useCanUseTool.tsx` |
| headless y8r | `src/QueryEngine.ts` |
| MCP noops | `src/entrypoints/mcp.ts` |
| teammate Ina | `src/utils/swarm/inProcessRunner.ts` |

## Tests

- `sessionPermissionPersist.234.test.ts` — y8r / n3e / createSubagentContext inherit / persist session allow+deny / teammate Ina override

## Residual（非 invent）

- densable workflow agent ctx 内联 `{setAppState:()=>{}, setToolPermissionContext:()=>{}, setSessionToolPermissionContext:e...}`：本地生产 TS 未找到独立站点；async AgentTool 已由 `createSubagentContext(!shareSetAppState)` 等价覆盖。
