# densable 2.1.214 Batch D — bg / daemon / RC

> Binary: `%TEMP%/official-214/package/claude.exe`

## 已落地（1:1）

### #47 SessionStart `source: "fork"`

| densable | 本地 |
|----------|------|
| matcher `values:["startup","resume","clear","compact","fork"]` @~244610967 | `hooksConfigManager.ts` |
| schema `S.enum([...,"fork"])` @~248759505 | `coreSchemas.ts` + `coreTypes.generated.ts` |
| `$6r` / `I1e`: `hook_event_name:"SessionStart",source:e` | `executeSessionStartHooks` / `processSessionStartHooks` |
| title cache `e==="startup"\|\|e==="resume"\|\|e==="fork"` @~235762746 | `sessionStart.ts` |
| REPL `I1e(xr==="fork"?"fork":"resume",…)` @~248479616 | `REPL.tsx` |
| recovery `I1e(r.forkSession?"fork":"resume",…)` @~235780107 | `conversationRecovery.ts` + `main.tsx`/`print.ts` 透传 `forkSession` |
| branch `e.resume(i,m,"fork")` @~240263718 | 已有 `branch.ts` → `ResumeEntrypoint 'fork'` |

### #43 RC home trust

| densable | 本地 |
|----------|------|
| interactive: `Rdr.homedir()===At()` → ``Error: Workspace not trusted. ${E} is your home directory, and for security home-directory trust is never saved, so running `claude` here first won't help. Run `claude rc` from a project directory instead (run `claude` there once to accept the trust dialog).`` @~241229675 | `bridgeMain.ts` (interactive path) |
| non-home: ``Error: Workspace not trusted. Please run `claude` in ${E} first to review and accept the workspace trust dialog.`` | same |
| headless: ``Workspace not trusted: ${r} is the home directory, whose trust is never saved — running `claude` there first won't help. Run Remote Control from a project directory instead.`` @~241244625 | `runBridgeHeadlessImpl` |
| 判定：`homedir() === getCwdState()`（setCwd 之后） | 对齐 densable `Rdr.homedir()===At()` |

### #26 control socket skipUnlink（yield 不删继任者）

| densable | 本地 |
|----------|------|
| aAp `close:(A)=>… if(A?.skipUnlink) return y=!0,_.unref(); else _.close(()=>{if(!A?.skipUnlink) unlink})` @~244258103 | `controlSocket.close({skipUnlink})` |
| BG4 `close:async(V)=>{G=V?.displaced; w.close({skipUnlink:G\|\|V?.skipPathCleanup}); if(!G&&!skipPathCleanup) rm(instanceDir)}` @~249608581 | `bgManager.close({displaced,skipPathCleanup})` |
| yield 路径 `te.close({skipPathCleanup:!0})` @~249628283 | `main.ts` onYield → `shutdown('yield',{displaced:true,skipPathCleanup:true})` |
| error path `r?.close(pid===self?void 0:{skipUnlink:!0})` @~249609185 | 后续可接 start 失败路径（当前 yield 主路径已覆盖 #26） |
| 测试 | `controlSocketSkipUnlink.214.test.ts` |

### #28/#29 `claude rm` + agents view delete（C2e / gJ_）

| densable | 本地 |
|----------|------|
| `async function C2e(e,t={})` kill xKe → worktree dirty/unpushed/in_use/live_lock → F0e remove → rm jobdir @~244307199 | `src/daemon/deleteJob.ts` `deleteJob` |
| kill_unconfirmed 跳过 jobdir/worktree 删除 | `errorCode: 'kill_unconfirmed'` |
| FleetView `await C2e(o.id,{force:!0})` @~248129353 | `AgentView` `deleteJob(short,{force:true})` |
| `gJ_` Usage / No job / Ambiguous / kept worktree / restarting @~244356006 | `cli/bg.ts` `rmHandler` |
| top-level `t[0]==="rm"` → `y.rmHandler` @~249668587 | `cli.tsx` `args[0]==='rm'` + `daemonMain` case `rm` |
| NHe `/^[a-f0-9]{8}$/` job dir filter | `JOB_SHORT_RE` + `resolveJobShortByPrefix` |
| force 下 non-git / remove fail → left_in_place 仍删 session (#29) | `opts.force \|\| gitError` → `leftWorktreeDir` |
| 测试 | `deleteJob.214.test.ts` |

**故意未 1:1 的 densable 边角（不发明）：**

- full worktree registry `live_lock`（`$0e`/`e5e`/`U9i` lockReason）— 本地无完整 lock 注册表；`in_use` + kill_unconfirmed 覆盖主路径
- analytics `cli_bg_rm` / `tengu_bg_agent_action` sink 细节

### #32 agent-view vs no-terminal bg 命令拒绝

| densable | 本地 |
|----------|------|
| `Wet()` SESSION_KIND ∈ bg/daemon/daemon-worker；`ts()=Wet()==="bg"` | `isBgSession()` via `CLAUDE_CODE_SESSION_KIND==='bg'` |
| `uE()=kt.attacherCaps`；`tii` set from rendezvous | `getAttacherCaps`/`setAttacherCaps` in `bootstrap/state.ts` |
| `Pte()=ts()&&!uE()` | `isBgSessionWithoutTerminal()` |
| `yfy` on `attacher-caps` → tii(caps) | `rendezvousServer` case `attacher-caps` |
| attach sends caps；last attacher leave → null | `bgManager` `sendAttacherCaps` already |
| KGo MCP auth / uYp /mcp panel / ufb install-github-app | mcp.tsx / MCPRemoteServerMenu / install-github-app.tsx |
| enable/disable 仍可（steer without panel） | mcp enable/disable 在 Pte 门前 |
| 测试 | `bgNoTerminal.214.test.ts` |


### #27 idle park `←`/`/background` reclaim (retireIfSettled tempo:idle)

| densable | 本地 |
|----------|------|
| `bh(e)=cF(state)&&tempo!=="active"` @~238159123 | `isBhSettled` |
| `retireIfSettled` settle: `bh(n)\|\| non-exec (tempo idle \|\| blocked-blocked \|\| YP interactiveLineage)` @~241399611 | `isEligibleForRetire` |
| YP=`"send a prompt to start"` | `EMPTY_PROMPT_NEEDS` |
| L4d detritus kinds `local_bash/in_process_teammate/dream/auto_mode_scan` | `RETIRE_DETRITUS_KINDS` + `hasBlockingInFlight` |
| host-managed `exe(dispatch)=PROVIDER_MANAGED_BY_HOST` | `dispatch.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` → `host-managed` |
| empty-idle / spare / grace / attached / pinned / recent-adopt | 既有路径保留 |
| 根因：旧本地 `if (!isTerminalState) not-settled` 不回收 tempo:idle 的 park 会话 | **已修** |
| 测试 | `retireIfSettled.214.test.ts` |

**故意未 1:1：** low-mem pre-spawn `WZa().retireIfSettled` 调度细节、analytics `tengu_bg_retired` 全字段、auth-rekey 与 retire 交叉边角（既有路径已 defer）。

### #30 unreadable folder in session store reopen

| densable | 本地 |
|----------|------|
| `$yi(path)`：`lstat` 非 file→`none`；ENOENT→`none`；open/read 错→`unknown`；user\|assistant→`has` @~230634204 | `probeTranscriptPresence` |
| `Dyi` = `$yi !== "none"`（unknown 当 present，避免假 refuse） | `transcriptHasMessages` |
| `gTe` 主候选 Dyi 命中即返；projectsScan 仅 `isDirectory` + `$yi==="has"` 且 **恰好 1** 命中 @~230634907 | `probeResumeTranscript` |
| NMt `readdir({withFileTypes})` + `isFile()` 过滤 jsonl | `listCandidates` / `getSessionFilesWithMtime` |
| rWe `stat` size>0 解析 session 文件 | `resolveSessionFilePath` + `isFile()` |
| attach/getTranscriptPath 禁止 `existsSync`/`access` 把目录当 transcript | `bgManager.resolveAttachTranscriptPath` / `bgWorker.getTranscriptPath` / `jobState.readLastAssistantLine` |
| 根因：`*.jsonl` 名目录 / 不可读 sibling 使 reopen 选错路径或中断 | **已修** |
| 测试 | `transcriptProbe.test.ts` #30 + `listCandidates.214.test.ts` |

**故意未 1:1：** SDK `importSessionToStore`/`InMemorySessionStore` 全量 adapter（本地无该产品面）；QRt densable 仍 name-only readdir+stat catch（本地对齐 NMt 更严）。

## 待深挖（未落地）

1. **#31** RC session-ready push — densable `nZp`/`oZp`/`iZp` @~245088519：`I0e()`=GB `tengu_kairos_push_notifications`；nudge `tengu_kairos_ready_nudge`；`oZp(cfg, explicitRC, outboundOnly)` 在 bg/agentId 拒绝；`tips_rc_ready_push_send` + config counters。KAIROS 约定不再加码；队列文案「sends once the session is ready」≠ push

本地相关：`src/daemon/*`、`src/cli/bg*`、`src/bridge/*`、hooks SessionStart。
