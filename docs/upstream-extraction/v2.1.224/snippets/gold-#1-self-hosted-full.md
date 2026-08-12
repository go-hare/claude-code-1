# Gold #1 — self-hosted-runner full extraction (v2.1.224 densable)

| Field | Value |
|-------|--------|
| **Binary** | `/tmp/official-224/plat/package/claude` (darwin-arm64 SEA) |
| **VERSION** | `2.1.224` (BUILD_TIME `2026-08-06T01:05:53Z`, GIT_SHA `8a2a469b68f918917492973f3b16bd1682b9f82c`) |
| **Changelog** | “Added self-hosted environments: `claude self-hosted-runner` …” (Team/Enterprise) |
| **Method** | Printable-string scan + densable JS recovery from SEA |
| **Invent-ban** | Algorithms not fully recovered → stub only, no invent |

Related: `gold-#1-decode-token.txt`, `gold-#1-code-sign.txt`, `gold-#1-runner-api.txt`, `gold-#1-root-runner.txt`, `/tmp/shr-extract-224/*`.

---

## 1. CLI dispatch (no feature gate)

```text
if (t[0] === "self-hosted-runner") {
  r("cli_self_hosted_runner_path");
  let m = t[1];
  if (m === "orchestrator") → selfHostedRunnerOrchestratorMain(t.slice(2))
  if (m === "setup")        → selfHostedRunnerSetupMain(t.slice(2))
  if (m === "doctor")       → selfHostedRunnerDoctorMain(t.slice(2))
  if (m === "code-sign")    → selfHostedRunnerCodeSignMain(t.slice(2))
  if (m === "decode-token") → selfHostedRunnerDecodeTokenMain(t.slice(2))
  else                      → selfHostedRunnerMain(t.slice(1))
}
```

| Export | Role | go-hare |
|--------|------|---------|
| `selfHostedRunnerMain` | Root work runner (poll sessions) | **HAVE** `rootRunner.ts` |
| `selfHostedRunnerOrchestratorMain` | Spawn-hints orchestrator | **HAVE** `orchestrator.ts` |
| `selfHostedRunnerSetupMain` | Setup wizard | **HAVE** `setupDoctor.ts` |
| `selfHostedRunnerDoctorMain` | Doctor wizard | **HAVE** `setupDoctor.ts` |
| `selfHostedRunnerDecodeTokenMain` | JWT decode/verify (**Yqv**) | **HAVE** |
| `selfHostedRunnerCodeSignMain` | Git SSH commit signing | **HAVE** |

---

## 2. decode-token / code-sign / LUi API

See `gold-#1-decode-token.txt`, `gold-#1-code-sign.txt`, `gold-#1-runner-api.txt`.

---

## 3. Root runner / rBh (HAVE full)

SEA module `PBh` @ ~267560385:

| densable | Name | Status |
|----------|------|--------|
| wBh | `parseRootArgs` | **HAVE** |
| ABh | `resolveEnvironmentSecret` | **HAVE** |
| RBh | `resolveExec` | **HAVE** |
| bBh | `readRetireAtEnvMs` | **HAVE** |
| IBh | `derivePollInterval` | **HAVE** |
| CBh | `sessionBoundCapacityWarning` | **HAVE** |
| azv | `selfHostedRunnerMain` | **HAVE** register + health + poll + qUi + Q2h/eBh |
| xBh | `runPollSkeleton` | **HAVE** full idle/retire/deassign/release/drain |
| hFh | `startHealthServer` | **HAVE** `healthMetrics.ts` |
| tqv/rqv | Prometheus + OTLP ingest | **HAVE** |
| uBh/Yjv/ZJl | SSE work-hints + wake queue | **HAVE** `workHintsSse.ts` |
| rBh/sjv | session handle + child spawn + FD3 activity | **HAVE** |
| aWd/Fjy/$jy | built-in git prepare | **HAVE** `gitPrepare.ts` |
| bjv | HOME-level git-proxy sanitize | **HAVE** `gitConfigure.ts` |
| Ojv/Djv/Pjv/Hjv | outcome helpers | **HAVE** |
| Ane/GE_/VE_/KE_ | full process-tree kill | **HAVE** `gitPrepare.ts` |
| kjv/EKn/tre | confine enforce/warn/off | **HAVE** `sessionConfine.ts` |
| D / sG·Kw·f2t | trust seed + global temp EKn | **HAVE** `sessionSeed.ts` |
| mcp_config | remote base64 → mcp-config.json | **HAVE** `sessionSeed.ts` |
| B2h/Bjv/Fjv/Ijv/W2h/xjv/z2h/CKn | rBh residual runtime | **HAVE** `sessionRuntime.ts` + wire |
| Zt/ye/He/De | CKn bg settle → re-WJl latest token; finally He + B2h | **HAVE** `createIngressFenceBgController` |
| finally unlink ne/de | completed unlink debug; always unlink mcp-config | **HAVE** `cleanupSessionSideFiles` |
| AKn + Ge | epoch fence trip → abandoned; skip push-on-release | **HAVE** sessionHandler catch + epochStaleForCleanup |
| F2h session_token | `writeDebugTokenFile(..., session_token_${id}.jwt)` | **HAVE** issueSessionToken 后 dump |
| Be + Tjv | `proxyCredTracksLive` + `unsetGitProxyRepoLocalCredHelper` | **HAVE** finally 双 unset credential.helper |
| onChildLifecycle map | deferred completed/failed; idle-release/deassign→completed | **HAVE** sessionHandler reclass |
| finally Le/qe/Ue + Fjv | worktrees + outcome + hook rm + Fjv in outer finally | **HAVE** abandoned 亦清理；Fjv 非 Je 门控 |
| sjv governed env | spawn → `buildSessionChildEnv` gitConfig/ghShim/GIT_CONFIG_GLOBAL | **HAVE** densable pt/J |
| onChildInit / exit-before-init | `onInitObserved` ends init；finally `!initEnded` | **HAVE** densable Q/G |
| $e/Ze/YJl + qUi | session-gone end_session + session token refresh | **HAVE** `sessionFailure.ts` + rBh wire |
| pre-spawn `/remote` Y=jt | full remote replace (not inference_auth patch) | **HAVE** `remote = freshRemote` + F2h after |
| Y.api_base_url post-replace | spawn/Y2h/Fjv re-read after `Y=jt` | **HAVE** `let apiBaseUrl` + re-sync on freshRemote |
| CLAUDE_CODE_SESSION_ACCESS_TOKEN | process.env when git-proxy A | **HAVE** densable 1:1 process-global（capacity>1 race 共有，禁 invent per-session） |
| OJl/dGr/pGr | runner vs session auth headers | **HAVE** `runnerApi.ts` + pGr gold |
| H2h/M2h/vKn/D2h | checkout/post-session hooks | **HAVE** `sessionHooks.ts` |
| fjv/mjv | git-proxy / governed mount rewrite | **HAVE** `sessionHooks.ts` |
| WJl + CKn fence | session-ingress token write + bg | **HAVE** `sessionSeed.ts` |
| Y2h | post-exit failure diagnosis | **HAVE** `sessionFailure.ts` |
| qqv/$qv/h2h/eBh | git proxy / signing / coauthor / seed | **HAVE** `gitConfigure.ts` |
| tur/qUi/q2h/j2h | token refresh + stdin push + ack sweep | **HAVE** `tokenRefresh.ts` |
| Q2h/Z2h/ejv | host config snapshot + MCP filter | **HAVE** `hostConfig.ts` |
| seedHostConfigIntoSession | host-config write into session dir | **HAVE** `sessionSeed.ts` |
| He | activity NDJSON ledger | **HAVE** `sessionActivity.ts` |
| kFh | SCM connector tunnel | **HAVE** `scmConnector.ts` |
| JFh | orch health extras | **HAVE** `orchestrator.ts` |

Defaults: capacity **1**, base-dir **`/workspace`**, health-port **8080**, session-stop-grace **5s**, post-session-hook-timeout **60s**, startup-timeout **15 min**, api `https://api.anthropic.com`.

**#1 residual invent-ban：** 无（可恢复算法均已 1:1）。非 #1：UNKNOWN 15–16/24–25；#31 VSCode N/A。

---

## 4. Orchestrator / setup / doctor (HAVE)

See prior gold notes; product in `orchestrator.ts` / `setupDoctor.ts`；kFh/JFh residual HAVE。

---

## 5. Gold tests

| File | Covers |
|------|--------|
| `decodeToken.224.test.ts` | Yqv |
| `codeSign.224.test.ts` | Wqv |
| `runnerApi.224.test.ts` | LUi |
| `rootRunner.224.test.ts` | parse/secret/exec/poll helpers |
| `orchestrator.224.test.ts` | orch |
| `orchestrator.metrics.224.test.ts` | JFh metrics |
| `setupDoctor.224.test.ts` | setup/doctor |
| `sessionChild.224.test.ts` | sjv args/env |
| `sessionHooks.224.test.ts` | hooks + fjv/mjv |
| `healthMetrics.224.test.ts` | hFh/tqv |
| `workHintsSse.224.test.ts` | SSE |
| `tokenRefresh.224.test.ts` | tur/qUi/q2h/j2h |
| `sessionActivity.224.test.ts` | He |
| `gitConfigure.224.test.ts` | $2h/d2h pure |
| `gitPrepare.224.test.ts` | aWd/Fjy/Ane |
| `hostConfig.224.test.ts` | Qqv/ejv |
| `sessionHandler.failure.224.test.ts` | TE/qrr/v4o + Y=jt + apiBaseUrl re-sync + SESSION_ACCESS process-global gold |
| `sessionConfine.224.test.ts` | kjv/EKn/tre |
| `sessionSeed.224.test.ts` | D trust / mcp_config / sG·Kw·f2t |
| `sessionRuntime.224.test.ts` | B2h/Bjv/Fjv/Ijv/W2h/xjv/z2h/CKn/Zt/unlink |
| `scmConnector.224.test.ts` | kFh |
| `sessionFailure.224.test.ts` | Y2h |

Focused: `bun test src/self-hosted-runner/__tests__/` → **204 pass / 22 files** (2026-08-11；含 `$e`/qUi/Zt/unlink/Be/F2h/AKn/governed-env + **Y=jt** full remote replace + **apiBaseUrl post-replace re-sync**（行为金测 spawn=second base）+ pGr headers + SESSION_ACCESS process-global densable-same）。
