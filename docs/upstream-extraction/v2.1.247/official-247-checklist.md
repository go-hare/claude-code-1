# densable 2.1.247 — 官方更新清单 × tip 对照

> 来源：CHANGELOG **2.1.247**（33 bullets）。SEA `@anthropic-ai/claude-code-win32-x64@2.1.247` 已下。  
> 基线：本地 tip densable **2.1.243** + **2.1.246** + npm **2.7.49**。**本 pack 只盘点 2.1.247**（勿折入 248+）。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 更新：2026-09-17 — UNKNOWN 复剥后 HAVE **29** / PARTIAL **0** / UNKNOWN **2** / N/A **2**。  
> 更新：2026-09-18 — 复审补接线（#2 内置 tip 标注 / #7 REPL host / #22 失败退出 / #25 Node 兜底）；桶不变。  
> 更新：2026-09-19 — #1 接 leftover `jr`/`Dfs`/`Ri`/`Nfs`。HAVE **31** / PARTIAL **0** / UNKNOWN **0** / N/A **2**。  
> 更新：2026-09-19 — #1 `Lfs` `DE` leftover-locked（`validateStorageKey`）。`ye`/`Ht`/`Jt` 体未剥。HAVE 桶不变。  
> 更新：2026-09-19 — **本 pack 已收口**（HAVE **31** / PARTIAL **0** / UNKNOWN **0** / N/A **2**）。不要再挖本清单。未进 tip（npm 仍 **2.7.49** = 243+246）。  
> 更新：2026-09-20 — 247 已入库，npm **2.7.50**。不折入 248+。  
> 口径：本地实现 + 已锁 SEA 函数体是合同。changelog 字面大于代码 → **不升桶、不 invent**。禁止 invent 云宿主 / 248 `--restricted`。

## Summary

| 状态 | 计数 | 备注 |
| ---- | ---- | ---- |
| **HAVE** | **31** | #1–#22 #25–#33（#23/#24 不在此桶） |
| **PARTIAL** | **0** | |
| **GAP** | **0** | |
| **UNKNOWN** | **0** | |
| **N/A** | **2** | #23 #24 云宿主 |

## Checklist

| # | key | 官方要点 | 状态 | 证据 |
| - | --- | -------- | ---- | ---- |
| 1 | send-feedback | `SendFeedback` + `/feedback` 审发；`feedbackDrafts` 可关 | **HAVE** | 工具 + gates + `Fqe`/`QO`/`Ewc`/`ot` + `/config` `Co()?[{id:"feedbackDrafts",label:"Claude-drafted feedback",options:notify/quiet/off,via:"config"}]`（`Co` leftover-wired `Ufs`）+ leftover `sr`。命令表 leftover-locked：`feedback` 无 alias；`/bug` 独立（官方 `aliases:["share"]` **不**落地）。`jr`：`aLt() && !args.trim() && !Ht()` 才 `sr`，否则 `en`；`Ht`=`_158 Ps` 体未剥，leftover-wired 不挡门。`/bug`=`en`。`ot`：`_e`=`Dfs`（重建路径，不读 `session_file`）；`E`=`Ri` 尾 `Es=4MiB`，`M<h` 丢首行；同会话 `ye(m)` + raw；他会话 `ogr` 再 `Oe`；成功且同会话 `W()`。`Nfs` 先 `Dfs`，同会话 `stat`，他会话 `readTail(rgr=256KiB)`+`ogr`。`$t`=`Lwc`。`Lfs` leftover-locked：`ol` 后 `_r.transcript` + `DE`=`validateStorageKey`（`Ja`/`qcd`）。`ye` 体未剥（仍 Oe 谓词滤直播）。`Ht`/`Jt`=`_158` 体未剥。changelog 超卖不 invent。`gold-1-jr-call-247.txt` / `gold-1-Dfs-Nfs-Ri-247.txt` / `gold-1-ye-Ht-Jt-DE-verdict.txt`。 |
| 2 | spinner-tips-org | object tips + `tipsFile` + `label` + pick | **HAVE** | `nt`/`rt`/`Ne`/`Ae`/`v`；`Pi` 先 cooldown 滤 org（`s`），`trustedCount>0&&Wt()` 只回 `s`。内置：`failedTipIds` → `Pe()!=="firstParty"\|\|!Ie()` 只留 `providerAgnostic` → `Lo(advertisedCommand)` → `Do` catch → Joi，再拼 `s`。`Vhe`=`Whe`→`qhe`，无 FORCE_TIP。`orgTips.ts` / `tipRegistry.ts` / `tipScheduler.ts`。**2026-09-18**：`providerAgnostic` 原先只标 org/marketplace，内置全漏 → 非 firstParty provider 内置 tip 全被滤掉。剥出上游 66 条 tip 的标注表 `gold-tips-providerAgnostic-0.txt`，按表补 33 条；`feedback-command`/`guest-passes` 等 Anthropic 账号类**照上游不标**。`tipProviderAgnostic.247.test.ts`。 |
| 3 | bash-auto-mode-tip | Bash 权限一键 “Yes, and switch to auto mode” | **HAVE** | `xOe`/`KNe`/`NX`/`UNe`。`WORKFLOW_AUTO_MODE_LABEL` 仍是 239 workflow 句。`permissionBashAutoMode.247.test.ts`。 |
| 4 | claude-api-cost-optimize | `/claude-api cost-optimize` | **HAVE** | 官方 `shared/cost-optimization.md` + SKILL.md 行 + `CLAUDE_API_SUBCOMMANDS` + `SKILL_FILES`。不自写指南。`claudeApi.247.test.ts`。 |
| 5 | claude-api-admin-cmek | Admin API / CMEK | **HAVE** | 官方 `shared/admin-api.md`（2026-08-26，`client.beta.organization`）。装配已 inline。`claudeApi.247.test.ts`。 |
| 6 | arrow-enter-row | 快按方向键再 Enter 点到上一行 | **HAVE** | 247 accept：FuzzyPicker `r[ke().focus]`；`/mcp` `he[B()]`；`/config` `he[tt()]`；bg `Ie[ce()]`。每文件 ref，无共享 helper。`/model` 仍 235 `getFocusedValue`。`gold-6-arrow-enter-proof.txt`。 |
| 7 | subagent-first-404 | 子代理首包 404 走 fallback；父错误带 type/status/request id/model | **HAVE** | `tss` + `l2e`；`fallbackModel` 原样 flatten。`subagentApiError.247.test.ts`。**2026-09-18**：`_buildToolUseContextWith` 解构 `fallbackModel:g`，但本地只有 headless（`QueryEngine.ts`）传了，`REPL.tsx` 的 `options` 漏字段 → 交互会话里 `--fallback-model` 对子代理无效。补 `main.tsx` `sessionConfig` → REPL prop → `options`。 |
| 8 | hook-mb-ptl | hook/后台喷 MB → PTL | **HAVE** | `lre`≡246 `Rne`，阈值 `JWr`=`1e4`。本地 `persistHookOutput` 接 stdout / additionalContext / systemMessage / initialUserMessage + `/add-dir`。stderr / blockingError 仍全文。**不 invent** 1MB/2MB。`gold-8-pass2-verdict.txt`。 |
| 9 | kitty-cyrillic-ctrl | kitty 非拉丁 Ctrl | **HAVE** | `Ea`：ctrl + primary>127 + base → base。`kittyCyrillicCtrl.247.test.ts`。 |
| 10 | mouse-split-esc | `<35;150;7M` 进提示 | **HAVE** | `flushedEscapePrefix` + `jM` SGR。`flushedEscapePrefix.247.test.ts`。 |
| 11 | sandbox-settings-symlink | sandbox 清 `settings.json` 软链 | **HAVE** | `LZ` hop-spare；wrap `await fN(),pN(),VZ(),FZ()`；`WZ` 回主 `.git`；`Te()` WeakMap + `ro`。`kv`=`Rt`。`Vm`=`ne`（`!ae`+`Dr`）；`Ji`=`ko`；`Qi`=`xe` hop-walk（`$o` 死臂）；`wv`=`Ue.record`。`gold-11-ne-win.txt` / `gold-11-ae-regexes.txt` / `gold-11-Ue-ident.txt`。 |
| 12 | terminal-setup-zed-merge | `/terminal-setup` 整文件覆盖 Zed keymap | **HAVE** | `me`+`ut` jsonc merge。`zedKeymapMerge.247.test.ts`。 |
| 13 | rename-registry-fail | `/rename` 登记失败假装成功 | **HAVE** | `registryUpdated` + 官方后缀。 |
| 14 | compact-agent-prompt | `--agent` compact / Summarize 用默认 prompt | **HAVE** | `Ce` lookup + Summarize 传 `mainThreadAgentDefinition`。`compactAgentPrompt.247.test.ts`。 |
| 15 | agents-host-died | `claude agents` 宿主死后 opening… | **HAVE** | `failIfHostExited` → `EHOSTDEAD`。`checkPid` 仅 `!pty` 时 `kill(0)`（无 win32 LOCAL）。win32 `Di`：bun:ffi `GetExitCodeProcess`；Node 无 ffi 时 PowerShell `Win32_Process` listed→alive / missing→X（不 invent PTY `kill(0)`）。`gold-15-kill-0.txt`。 |
| 16 | hook-output-file-oom | 输出文件写失败内存涨 | **HAVE** | `hlo=16777216` + `RTe`。`diskOutput.247.test.ts`。 |
| 17 | install-gh-app-ssh | SSH 复制假成功 / 无浏览器立刻出 URL | **HAVE** | `ClipboardPath` + `/^c+$/` + 立刻 URL。`installGithubAppSshCopy.247.test.ts`。 |
| 18 | fg-shell-bg-exit | 前台带进后台的 shell `[exited with code -1]` | **HAVE** | `ADt`：`!isAdopted` 才写 footer。`-1` 不映射。`nsc` `isAdopted:true`；`eA` skip `[killed]`。`exitFooter.ts`。`gold-18-body.txt`。 |
| 19 | mkt-versionless-cache | 无 version 插件二次 scope 删 live cache | **HAVE** | `Yjo` aside+`Kjo`。`Fjo` `strictCache: QT(u)` ≡ `isPluginCacheStorageV5(pin.storageV5)`。无 `QT` 默认 false。`gold-19-QT-fn.txt`。 |
| 20 | rc-worktree-diff | `/remote-control` 不报 working-tree diff | **HAVE** | 是 pull：`get_workspace_diff` + `jn`/`Yt`/`cd`。无 callback → 官方 not-supported；`ht=8000`。REPL `400/1500`，headless `2000/6000`。**不是 upload。** `gold-20-verdict.txt`。 |
| 21 | runner-premature-running | runner 未起来就报 `running` | **HAVE** | register 时 `worker_status` 省略。`runnerPrematureRunning.247.test.ts`。 |
| 22 | gateway-first-run-connect | managed gateway + Anthropic 不通 → 首次 setup 死 | **HAVE** | `Q$`/`Z$`：gateway 强制时跳过 Anthropic preflight。`Z$=Cs=ri(Hs)`：`ri` 丢掉 `severity==="warning"`；无 severity 仍算。alias both-keys 带 `severity:"warning"`。`onboardingPreflight.247.test.ts`。**2026-09-18**：门本身对，但失败分支原先只在 `CLAUDE_CODE_STRICT_PREFLIGHT=1` 时退出，默认把 onboarding 卡死（错误屏无按键处理）。上游 `ft(){Q("preflight_endpoint"),process.exit(1)}` 经 `O(ft, 失败?100:null)` 无条件退出 —— 已对齐。`preflight_endpoint` 不在 247 exit-reason enum，`Q` 无本地对等物，只移植退出本身。**无条件退出把 3P 误判从「难看的错误屏」升级成「起不来」**，所以 `is3P` 必须同步修准：抽出纯函数 `isThirdPartyProviderConfigured(settings, env)`，按 `getAPIProvider()` 的优先级排 —— 云厂商 `CLAUDE_CODE_USE_*` 压过 `modelType`，第三方 `modelType` 钉住，OpenAI 系 env 排在 `modelType === 'anthropic'` **之下**。原先只看 `*_BASE_URL`，而 gemini/grok 的 base URL 有默认值，`CLAUDE_CODE_USE_GEMINI=1` 单独就是完整配置却认不出来；反过来把 USE_* 无条件算作 3P 又会踩 CLAUDE.md 记的 `settings.env` 残留坑（`/login` 留下的 `CLAUDE_CODE_USE_OPENAI` 经 `applyConfigEnvironmentVariables` 进 `process.env`，会把已登录 Anthropic 的用户判成 3P）。`thirdPartyProviderConfigured.test.ts` 锁这条优先级。 |
| 23 | cloud-perm-mode-stale | 云会话权限模式旧值 | **N/A** | 云宿主。 |
| 24 | cloud-container-restart | 云容器回合间重启静默 | **N/A** | 云宿主。 |
| 25 | marketplace-invisible-name | marketplace 名控制/不可见拒绝 + 输出 escape-safe | **HAVE** | 名 schema 已接。打印合同是 247 `n0c`/`k`（≠246 `uYc`/`h`）+ `re`/`Io`/`U`；`/plugin` finish/setResult 走 `re(name)`。JSON 不洗。`escapeSafeText.ts`。`marketplaceEscapeSafe.247.test.ts`。**2026-09-18**：`n0c` 的 `s()` 原先直接调 `Bun.stripANSI`，而 `dist/cli.js` 也要能 `node` 跑（`post-build.ts` 只 patch `globalThis.Bun` 解构，不管直接调用）→ Node 下 ReferenceError 打穿整条 marketplace 打印路径。改用 `strip-ansi`。同一 bug 的另一处 `dontAskAgainLabel.ts` `sanitizeDontAskCwd` 更隐蔽：try/catch 吞掉 ReferenceError 后既不脱 ANSI 也不补 U+FFFD，等于权限对话框标题的 ANSI 注入防护静默失效 —— 一并改掉。 |
| 26 | mcp-fail-tell-claude | 3P / 关 telemetry：MCP 没连上要告诉 Claude | **HAVE** | `Xb` 默认 `true`（246 默认 false）。`surfaceFailedMcpServers.247.test.ts`。 |
| 27 | sonnet5-autocompact-967k | Sonnet 5 满 1M：~967K 不再 ~934K | **HAVE** | `y3n` default `1e6`；`1M-20k-13k=967K`。`autoCompactWindow.247.test.ts`。 |
| 28 | peer-message-collapse | peer 默认一行 `Message from @:` | **HAVE** | `xt`+`ly(body)` 首行预览。`peerCollapse.247.test.ts`。 |
| 29 | md-hyperlink-unsafe | 网络/automount/控制符超链接当纯文本 | **HAVE** | `d(a)` + `byd`/`Txd`/`Fxd`/`Dtb`/`Etb`。win32 `J`/`Dtb` 官方 `return false`，不编 `/net`。`markdownFileUrl.ts`。`gold-29-helper-*.txt`。 |
| 30 | pr-badge-refocus-1m | 重聚焦且上次检查 <1 分钟跳过 | **HAVE** | `Wut=60000`。`usePrStatus.247.test.ts`。 |
| 31 | analytics-off-startup | managed gateway / 自定义 OAuth：启动就关 analytics | **HAVE** | `IP`/`Gd` 进 `hu`。未锁的 `Bt`/`Pt`/`Io` 不编。`analyticsStartup.247.test.ts`。 |
| 32 | surface-claude-code | `surface=claude_code` + `User-Agent: claude-code/…` | **HAVE** | `jr` + `be`/`pr`。`gatewayLogin.247.test.ts`。 |
| 33 | org-login-managed-unreadable | managed 读不到就退出（即使有 host/HKCU） | **HAVE** | fail-close 官方句，在 HKCU/host pin 前。`policyUnreadable.247.test.ts`。 |

## 已锁合同

1. **#2** — `nt`/`rt` + `Pi` extras（`failedTipIds` / `providerAgnostic` / `Lo`）+ `Vhe`=`Whe`→`qhe`（sessions desc，再 priority desc）+ Spinner `Et`。changelog「never-shown tie-break」不是合同。无 FORCE_TIP。  
2. **#1** — leftover 工具/`Fqe`/`QO`/`Ewc`/`ot` + `/config` `feedbackDrafts` 行 + leftover `sr` + leftover 命令表（`/feedback`/`/bug` 拆开，不偷 `/share`）+ `jr`/`Dfs`/`Ri`/`Nfs` + `ot` `ye`/`ogr`/`W` + `$t`=`Lwc` + `Lfs` `DE` leftover-locked（`validateStorageKey`）。`ye`/`Ht`/`Jt` 无体 = 对齐（invent-ban）。changelog 超卖不 invent。  
3. **#23/#24** — 云宿主 N/A。  
4. **#8** — `lre` leftover 已接；不 invent MB / stderr cap。**#19** `Yjo` aside + `Fjo` `QT(u)`。**#25** `n0c`/`k` 打印 + `/plugin` `re(name)`。**#6** accept。**#11** `LZ` + wrap `fN`/`pN`/`VZ`/`FZ` + `WZ` 主 `.git` + `Te()` WeakMap + `kv`=`Rt` + `Vm`=`!ae`+`Dr` + `Ji`/`ko` + `Qi`/`xe`（ae 深 40 跟软链；`$o`/`J` stub 跳过=多接受）+ `wv`/`Ue`。**#18** `!isAdopted`。**#20** pull。**#22** `ri` 丢 warning。**#29** `FE`/`pt`。  
5. **不**开 248。

## 下一步

1. **2.1.247 pack 已收口**（HAVE 31 / N/A 2 / UNKNOWN 0）。不要再挖 `ye`/`Ht`/`Jt` / 云宿主 / changelog 超卖。
2. 已入库。发布线 npm **2.7.50**（243+246+247）。不折入 248+。
3. 下一 pack 才看 248+。不 invent `--restricted`。
