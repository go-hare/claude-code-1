# densable 2.1.214 Batch A — 已落地权限项（go-hare）

> 权威 extract：`batch-a-security.1to1.md`  
> 本文件记录 **已 1:1 落地** 的代码映射与验证，非简化替代。

Binary 证据：`C:\Users\Administrator\AppData\Local\Temp\official-214\package\claude.exe`

---

## 状态总览（Batch A 子集）

| # | 主题 | 状态 | 本地映射 |
|---|------|------|----------|
| **1 + 44** | allow 单段 `dir/**` cwd-only；hook `if:` 同 allow；deny/ask any-depth | **HAVE** | `adjustPermissionPatternForIgnore` (o1d)、`matchingRuleForInput` (zw)、`matchesPathRule` (hqe)；File/Notebook `preparePermissionMatcher` |
| **3** | Bash fd redirect fail-closed | **HAVE** | `precheckFileRedirect` (hnu) + `walkFileRedirect` |
| **14** | docker daemon-redirect | **HAVE** | `DOCKER_DAEMON_REDIRECT_FLAGS` (oGr) + `dockerDaemonRedirectIsDangerous` (aQn) on `docker logs`/`inspect` |
| **16** | pkill 自保 | **HAVE** | `createPkillSelfGuardShellIntegration` (K2g) + Shell spawn `CLAUDE_PID` (TCt) |
| **45** | `file -m/-f` 非只读 auto-allow | **HAVE** | `file.safeFlags` 去掉 `-m`/`--magic-file`/`-f`/`--files-from` |
| **2** | PS 5.1 cwd-first shadow | **HAVE** | `psShadowStem`/`psCommandBaseAndStem` + Windows multi-subcmd write-stem → densable ask 文案 |
| **4** | Bash >10k always prompt | **HAVE** | densable 链：`parseCommandRaw` over-length → `PARSE_ABORTED`；`parseForSecurityFromAst` too-complex PARSE_ABORT；`checkReadOnlyConstraints` F7u；次级 K0e：CE/Uto/zOe/Eys（见下） |
| **5** | zsh `[[ ]]` 下标 | **HAVE** | `precheckTestCommand`(fnu) + `detectZshSubscriptOrModifier`(mnu) + `TEST_EXPR_STRUCTURAL`(pnu) + inert-gap(tnu) |
| **6** | help/man | **HAVE** | `manArgsAreDangerous`/`helpArgsAreDangerous` + densable safeFlags（man 无 `-l`；help 仅 `-d`） |
| **7** | remote 权限 + dialog race | **HAVE** | `RemoteSessionManager` permission+dialog dismiss/redelivery；`useRemoteUserDialog`(EEf)；schema `pending_*` |

---

## #1 + #44 — path glob

### densable → go-hare

| densable | go-hare |
|----------|---------|
| `n1d` | `normalizePermissionPattern`（内部） |
| `o1d` | `adjustPermissionPatternForIgnore` |
| `PXi` | `patternHasUnescapedStar`（内部） |
| `APs` / getIg | `getPatternsByRoot` + o1d per behavior |
| `zw` | `matchingRuleForInput` |
| `hqe` | `matchesPathRule` |
| File tools `(t)=>hqe(t,e)` | FileRead/Edit/Write + NotebookEdit `preparePermissionMatcher` |

### 语义钉死

- allow：`src/**` → ignore 引擎 `/src` → **仅 cwd 下 `src/`**
- deny/ask：`src/**` → `src` → **any-depth**
- hook `if:`：始终 `o1d(..., true)`（`matchesPathRule`）
- any-depth 用户写法：`**/src/**`

### 测试

`src/utils/permissions/__tests__/pathGlob214.test.ts`

---

## #3 — fd redirect fail-closed

| densable | go-hare |
|----------|---------|
| `hnu` | `precheckFileRedirect` |
| `h6i` / walk | `walkFileRedirect`（先 precheck） |

Reasons（与 densable 字符串对齐）：

- unparsed bytes between children / trailing
- fd-variable assignment
- close-fd + word
- `>&`/`<&` target starts with `-`
- multiple targets

测试：`src/utils/bash/__tests__/batchA214.security.test.ts`（parseForSecurity 形状；tree-sitter 因平台/语法可能 non-simple）

---

## #14 — docker daemon-redirect

| densable | go-hare |
|----------|---------|
| `oGr` | `DOCKER_DAEMON_REDIRECT_FLAGS` |
| `aQn` | `dockerDaemonRedirectIsDangerous` |
| logs/inspect callback | `DOCKER_READ_ONLY_COMMANDS['docker logs'|'docker inspect'].additionalCommandIsDangerousCallback` |

文件：`src/utils/shell/readOnlyCommandValidation.ts`  
测试：`src/utils/shell/__tests__/dockerDaemonRedirect214.test.ts`

---

## #16 — pkill self-guard

| densable | go-hare |
|----------|---------|
| `K2g` | `createPkillSelfGuardShellIntegration` → snapshot `PKILL_FUNC_END` |
| `TCt` env | `Shell.ts` spawn：`CLAUDECODE`、`CLAUDE_CODE_SESSION_ID`、`CLAUDE_CODE_CHILD_SESSION=1`、`CLAUDE_PID=String(process.pid)` |

测试：K2g 字符串钉死（运行时 /proc 仅 Linux）。

---

## #45 — file magic / files-from

`packages/builtin-tools/.../BashTool/readOnlyValidation.ts` `file.safeFlags`：

- **保留**：`-b`/`--brief`、mime 等只读输出格式
- **移除**（需权限）：`-m`/`--magic-file`、`-f`/`--files-from`（densable 表中无）

测试：`isCommandSafeViaFlagParsing('file -m …') === false` 等。

---

## Residual #2 — PS 5.1 cwd-first shadow

| densable | go-hare |
|----------|---------|
| `$mo` stem | `psShadowStem` |
| `Fmo` base/stem | `psCommandBaseAndStem` |
| `Rt()==="windows" && u.length>1` walk | `getPlatform()==='windows' && allSubCommands.length>1` in `powershellToolHasPermission` |
| ask message | 字面 densable 文案（`./${name}.*` shadow … 5.1 cwd-first） |

测试：`src/utils/bash/__tests__/batchA214.residual.test.ts`（helpers）

---

## Residual #4 — dual 10k（非独立 hard-gate）

| densable | go-hare |
|----------|---------|
| `Jru=1e4` | `MAX_COMMAND_LENGTH` in `parser.ts` |
| `tJt` over-length → `y0e` | `parseCommandRaw` → `PARSE_ABORTED` + telemetry |
| analyzer `t===y0e` | `parseForSecurityFromAst` → `too-complex` / `PARSE_ABORT` |
| `K0e` + `F7u` | `READ_ONLY_ANALYSIS_MAX_LENGTH` + passthrough message |

### 次级 `K0e` call-site 映射

| densable | effect when `length>K0e` | go-hare |
|----------|--------------------------|---------|
| `CE` | return `[e]` unsplit | `splitCommandWithOperators` → `[command]` |
| `Uto` | `true` (unsafe) | `isUnsafeCompoundCommand_DEPRECATED` → `true` |
| `zOe` | empty redirections analysis | `extractOutputRedirections` → empty redirections / no dangerous flag |
| `Eys` | sed ask + over-length reason | `checkSedConstraints` ask + densable reason + `bashMissKind:'sed-dangerous'` |
| `F7u` | read-only passthrough | `checkReadOnlyConstraints` (已钉) |
| `Shu` | tree-sitter simple-command list → `null` | 无独立命名导出；安全主链经 `parseCommandRaw`→`PARSE_ABORTED`→`too-complex` fail-closed，不走 legacy auto-allow |
| `Gx` | argv extract → `[]` | 同上（`parseForSecurity` over-length 不产生 simple commands） |
| `vhu` | dangerous redirect walk → `true` | 同上 + `extractOutputRedirections` over-length 空分析，由上层 permission 路径 fail-closed |

**勿发明**：没有单独的 permission-layer “always prompt” 文案闸。

测试：`src/utils/bash/__tests__/batchA214.residual.test.ts`（含 secondary K0e）

---

## Residual #5 — zsh `[[ ]]`

| densable | go-hare |
|----------|---------|
| `fnu` | `precheckTestCommand` |
| `tnu` | `testUnparsedBytesAreInert` |
| `pnu` | `TEST_EXPR_STRUCTURAL` |
| `mnu` | `detectZshSubscriptOrModifier`（reason 字面 densable） |

---

## Residual #6 — help / man

| densable | go-hare |
|----------|---------|
| `qm` | `argHasCommandSubstitutionMarkers` |
| man callback | `manArgsAreDangerous` |
| help callback | `helpArgsAreDangerous` |
| man.safeFlags | 无 `-l`；含 `-a/-d/-f/-k/-w/-S/-s`… |
| help.safeFlags | 仅 `-d` |

---

## Residual #7 — remote permission + dialog race

Binary：`claude.exe` class `aBa` ~`245753971`；dialog redelivery ~`245757389`；EEf ~`245779201`。

| densable | go-hare |
|----------|---------|
| `pendingPermissionRequests` Map | `RemoteSessionManager.pendingPermissionRequests` |
| `pendingDialogRequests` Set | `RemoteSessionManager.pendingDialogRequests` |
| `seenControlResponseIds` + `y5b=1000` FIFO | `seenControlResponseIds` + `SEEN_CONTROL_RESPONSE_ID_CAP` |
| cancel: dialog first, then permission; unknown ignore | same |
| `control_response` answered-elsewhere dismiss perm/dialog | same + densable log 字面 |
| `pending_user_dialog_requests` redelivery；skip seen；`remote_dialog_redelivery` | same + `logEvent` |
| `result` clears unresolved permission **and** dialog | same |
| `request_user_dialog` park / dup skip / no-callback unsupported | `handleControlRequest` |
| `respondToUserDialogRequest` + mark seen | same |
| success schema redelivery fields | `ControlResponseSchema` optional `pending_*` |
| EEf / R5b（仅 O5=`refusal_fallback_prompt`） | `useRemoteUserDialog` + `REMOTE_USER_DIALOG_HANDLERS` |
| useRemoteSession `onUserDialogRequest` / cancel | `useRemoteSession` 接线 EEf dispatch/cancel |

**未 1:1 port（densable 额外面，非 #7 changelog 必需）**：

- `pendingControlRequests` 全量 RPC 超时表（side_question / set_model 等）
- densable FYo 完整 remote permission→Ink dialog 桥（本地仍走 `ToolUseConfirm` queue；permission race 语义已对齐）

**勿发明**：「本地确认前硬拦 remote execute」新协议。

测试：

- `src/remote/__tests__/remoteSessionPermissionRace214.test.ts`
- `src/hooks/__tests__/useRemoteUserDialog214.test.ts`

---

## 有意未做 / 勿发明

1. **#4**：不单独写权限 hard-gate 产品文案；已按 densable parse-abort + F7u + 次级 K0e 语义落地。
2. **#7**：不发明「本地确认前硬拦 remote execute」的新协议；按 densable dismiss/cancel/redelivery 路径。
3. 不把 deny/ask 的 any-depth 改成 cwd-only（会破坏 densable 分叉）。
4. 不把 densable Shu/Gx/vhu 树遍历函数整段抄成未调用的死代码——安全入口已由 `parseCommandRaw` over-length → PARSE_ABORT 覆盖。

---

## 关联文件

- `src/utils/permissions/filesystem.ts`
- `packages/builtin-tools/src/tools/{FileRead,FileEdit,FileWrite,NotebookEdit}Tool/*`
- `src/utils/bash/ast.ts` / `parser.ts` / `commands.ts`
- `src/utils/bash/ShellSnapshot.ts`
- `src/utils/Shell.ts`
- `src/utils/shell/readOnlyCommandValidation.ts`
- `packages/builtin-tools/src/tools/BashTool/readOnlyValidation.ts`
- `packages/builtin-tools/src/tools/BashTool/sedValidation.ts`
- `packages/builtin-tools/src/tools/PowerShellTool/powershellPermissions.ts`
- `src/remote/RemoteSessionManager.ts`
- `src/hooks/useRemoteSession.ts` / `useRemoteUserDialog.ts`
- `src/entrypoints/sdk/controlSchemas.ts`
