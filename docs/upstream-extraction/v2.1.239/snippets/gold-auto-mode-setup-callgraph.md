# densable 2.1.239 — `/auto-mode-setup` 金标调用图（锁）

> SEA：`%TEMP%\official-239-pkg\package\claude.exe`  
> 锁日期：2026-08-28  
> 口径：**金标齐则 1:1 落；缺项 invent-ban。** tip 已按本图落地 slash/`nlg`/`llg`/`i$m`/`svr`/`xPl`（见 §9）。  
> 硬禁：不要 invent storageV5 host；不要薄 slash 绕过向导。  
> dump：`gold-wide-$y0.txt` · `gold-wide-nlg.txt` · `gold-wide-elg.txt` · `gold-wide-llg.txt` · `gold-wide-Grn.txt` · `gold-wide-xPl.txt` · `gold-function_*` 等

## 1. 双注册（同一 name）

| 符号 | type | isEnabled | 其它 |
| --- | --- | --- | --- |
| `xPl` | `"local"` | `KHl() && jn()` | `supportsNonInteractive:!0`；`isHidden` = `!jn()`；非交互 `--propose` / `--apply-file` |
| `_Gw` | `"local-jsx"` | `YHl() && !jn()` | `requires:{workspace:!0,ink:!0}`；交互走 `$y0` → `nlg` |

两边 `name:"auto-mode-setup"`，description `"Teach auto mode about your environment, plus optional rule tweaks"`。

## 2. 门

```
B4w() = !V.CLAUDE_CODE_REMOTE && D7r()
KHl() = B4w() && _Et().value !== ""
YHl() = KHl() && aO()?.envOnboarding === true
fqi() = YHl() && Jo().skillOverrides?.["auto-mode-setup"] !== "off"
```

`jn()` = 非交互。交互 slash 要 `YHl`；非交互 slash 要 `KHl`。

## 3. 交互 `$y0(e, t, r)`

1. 有参 → system：`/auto-mode-setup doesn't take arguments — run it on its own to open the setup dialog. In non-interactive mode, use --propose / --apply-file.`
2. `alg() || Nfc(t.taskRegistry)` → 扫描已在进行 / 收尾中。
3. `elg(ulg())` 初态：`step = existing|confirm`，`mode="append"`，`posture="mixed"`，`confirmSelection=["shell"]`。
4. 返回 `nlg` JSX：
   - `onBackgroundStart` **仅当** `t.requestDialog` 存在 → `llg({answers, mode, permissionContext, taskRegistry, requestDialog, appendSystemMessage, storageV5, credentials})`
   - `propose` → `Grn(..., t.storageV5, t.credentials)`
   - `write` → `svr({mode, autoMode: uhs(proposal)}, t.storageV5)`
   - `writeRemoval` → `svr({removeFromPermissionsAllow}, t.storageV5)`

`ulg()`：`userSettings.autoMode` 任一段非空 → hasExisting。

## 4. 向导 `nlg`（交互 ink，不是 AEo Host）

- 多步：`existing` / `confirm` / …；`elg` 初态见上。
- telemetry：`tengu_auto_mode_setup_wizard_shown` / `_resolved`。
- 后台开始后走 `llg`，**不**在向导里直接 `o(AEo)`。
- `uhs(proposal)`：`{environment, ...allow/soft_deny/hard_deny 非空才带}`。
- `wEo(writeResult, removal)`：落盘文案 + `claude auto-mode config`。

**`$defaults`（金标 `roe`）是 merge 哨兵，tip 无。** `TPl` 校验：allow/soft_deny/hard_deny 非空数组必须含字面 `roe`，否则当成 replace shipped rules；environment **禁止**含 `roe`。

## 5. 后台 `llg` → `Ly0` → `Ny0`

```
llg → uBo(true) → Ly0
Ly0: Dag(taskRegistry, abort, Nrn(answers).allProjects)  // type auto_mode_scan
     Ny0(...)
     finally lhs(..., "failed")   // 仅当 Ny0 未先 completed
Ny0:
  propose = Grn (默认)
  write   = svr (默认)
  Grn 失败 → appendSystemMessage + N6t error
  成功 → lhs(completed)
       → o(AEo, {...proposal, mode}, {queueBehind:!0})
       accept → svr({mode, autoMode: uhs(proposal)}, storageV5)
       若 remove_from_permissions_allow.length > 0
         → o(TEo, {flagged, runId}, {queueBehind:!0})
         → svr({removeFromPermissionsAllow: toRemove ∩ flagged}, storageV5)
```

探测 opener **不要只搜 `Gm(`**：auto_mode 是 `o(AEo|TEo)`。

## 6. 扫描 `Grn` + recon `i$m`

`Grn` = 机械 recon `i$m` + model json_schema。  
`i$m(cwd, Nrn(answers)=kqi 默认全 false, credentials?, storageV5)` 各节包 `C6e`（失败写 "not queryable here"）：

- CLAUDE.md files and project docs
- Repo facts
- Repo visibility & branch protection (`gh`)
- sibling docs
- Existing auto-mode settings (selective read)
- Recent usage in this project (**names only**)
- shell history（posix/psreadline/fish；Windows PSReadLine）
- home repos
- all-projects transcripts
- Config scans (names only)
- Shipped default auto-mode rule labels

`Nrn(answers)`：scope `all|project` × depth `both|shell|repos|here` → `{allProjects, shellHistory, homeRepos}`。默认 `kqi` 全 false。

## 7. 写盘 `svr` → `V3w`（**不是** storageV5 host）

```
V3w(e, t):
  n = db("userSettings")
  x_("userSettings", updater, void 0, t)   // t = storageV5，第 4 参锁/协调
  merge autoMode append|replace
  filter permissions.allow
  return {filePath, autoModeKeysWritten, environmentEntriesPreserved,
          permissionsAllowRemoved, permissionsAllowNotFound,
          permissionsAllowSkipped, warnings}
```

写的是 **userSettings 文件**。storageV5 只是 `x_` 第 4 参。  
2026-08-25 用户明确不接 storageV5 host（`MQA` 第二参 / `_O` / `BMi`）。

## 8. 任务 `auto_mode_scan`

- `hy0`：`type==="auto_mode_scan"`
- `Nfc`：registry 里 status==="running"
- `Dag`：register running + `skipTranscript:!0` + `gathersFromGitHubOrg`
- `lhs`：completed|failed + `Xg(..., {skipTranscript:!0})`

## 9. tip 对照（2026-08-28 — Phase 落地后）

| 金标 | tip |
| --- | --- |
| `$y0` / `_Gw` / `xPl` slash | **有** — `src/commands/auto-mode-setup/`（local-jsx + local dual） |
| `nlg` 向导全文 | **有** — `AutoModeSetupWizard.tsx`（existing/confirm/propose/review/flagged；SR=`Qag`） |
| `llg`/`Grn`/`i$m` | **有** — `background.ts` / `propose.ts` / `recon/gather.ts` |
| `svr`/`V3w`/`uhs`/`$defaults` | **有** — `write.ts`（`roe` 哨兵；storageV5 第 4 参忽略） |
| `o(AEo)` / `o(TEo)` | Qg + Host ymn/hmn；生产 opener=`llg`/`Ny0` |
| `auto_mode_scan` `Dag`/`Nfc`/`lhs` | **有** — `AutoModeScanTask` |
| `envOnboarding` | **有** — `AutoModeFlagConfig.envOnboarding` + `YHl` |
| `--propose` / `--apply-file` | **有** — `headless.ts` / `headlessArgs.ts` |
| `claude auto-mode` CLI | **有**（defaults/config/critique/reset）— 不是 slash |
| `AutoModeOptInDialog` | skipAutoPermissionPrompt opt-in，**不是** setup |

## 10. 结论

**1:1 产品面已落**（交互向导 + 后台 Host + 写盘 + 非交互 propose/apply）。仍禁止：

1. invent storageV5 host（`MQA` / `_O` / `BMi`）
2. 把 `AutoModeOptInDialog` / CLI `auto-mode` 当成 setup
3. 薄 slash 绕过 `nlg` 直接开简化 Host（已避免）

测：`src/services/autoModeSetup/__tests__/*.239.test.ts` · `src/dialog/__tests__/jsuQg.239.test.ts`
