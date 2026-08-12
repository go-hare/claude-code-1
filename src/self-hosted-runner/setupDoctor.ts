/**
 * densable 2.1.224 self-hosted-runner setup (Dqv/t2h) + doctor (Lqv/i2h).
 * 1:1 spawnSync wrappers with recovered system prompts + tool lists.
 *
 * Residual invent-ban: operator admin tools (self_hosted_runner_*) implementations
 * are product surface outside this CLI entry; wizard only enables their names.
 */
import { spawnSync } from 'node:child_process'
import { getOauthConfig } from '../constants/oauth.js'
import { resolveExec } from './rootRunner.js'

/** densable `Pqv` — setup tool allowlist CSV */
export const SETUP_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'TodoWrite',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'self_hosted_runner_get_pool',
  'self_hosted_runner_list_runners',
  'self_hosted_runner_list_secrets',
  'self_hosted_runner_read_health',
  'self_hosted_runner_read_metrics',
  'self_hosted_runner_spawn_local',
  'self_hosted_runner_tail_log',
].join(',')

/** densable `Hqv` — doctor tool allowlist CSV */
export const DOCTOR_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'TodoWrite',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'self_hosted_runner_get_pool',
  'self_hosted_runner_list_runners',
  'self_hosted_runner_list_sessions',
  'self_hosted_runner_list_secrets',
  'self_hosted_runner_read_health',
  'self_hosted_runner_read_metrics',
  'self_hosted_runner_tail_log',
  'self_hosted_runner_requeue_session',
].join(',')

/** densable `Oqv` */
export const SETUP_FIRST_MESSAGE =
  'Start the self-hosted runner setup wizard. Greet me and begin Phase 1 (create an environment in the Admin UI). Walk me through one step at a time.'

/** densable `Mqv` */
export const DOCTOR_FIRST_MESSAGE =
  'Start the self-hosted runner doctor wizard. Greet me, then ask me to describe the symptom or pick from the 8 diagnostic categories. Work through it one step at a time.'

/** densable SEA template placeholders (e/t) — built via PH_E/PH_T concat so source has no template-curly string lits. */
const PH_E = '${' + 'e}'
const PH_T = '${' + 't}'

const SETUP_PROMPT_TEMPLATE =
  'You are guiding an operator from zero to a working **self-hosted runner** for Claude Code on the web. The operator must leave able to do this themselves — you have typed tools that make *you* efficient, but every API tool you call returns an `equivalent.ui` path. **After every API tool call, surface that `equivalent.ui` path to the operator** so they can repeat the action without you.\n\nTools handle what\'s error-prone (auth, JSON parsing, starting the runner). You narrate what\'s learnable (UI paths, the product surface, deployment patterns). Environment creation and secret issuance happen in the **Admin UI only** — never via tools. The operator copies the secret value into a file on disk themselves; you only ever refer to the file path.\n\nIf the user passed `quick`, run Phase 1 only and stop with a one-paragraph summary.\n\n## Phase 1 — Prove it works (the "aha")\n\n1. **Create the environment in the Admin UI (operator action).** Tell the operator:\n\n   > "Open ' +
  PH_E +
  "/admin-settings/claude-code in your browser. Scroll to the **Self-hosted environments** section. Click **Create environment**, pick a name, and copy the environment secret (it's shown once). Paste the secret into `./runner-setup/ENVIRONMENT_SECRET` on this machine — I'll `chmod 600` it afterwards. Also copy the environment id (starts with `ccpool_`). Tell me the id and say 'done' when the file is saved.\"\n\n   When they respond, Bash `mkdir -p ./runner-setup && chmod 600 ./runner-setup/ENVIRONMENT_SECRET` and confirm the file exists + is mode 0600 (via Bash `ls -l`).\n\n2. **Verify the environment with the API.** Call `self_hosted_runner_get_pool({pool_id})` with the id. Confirm `alive_runner_count == 0`. If the call 404s, the operator copied the wrong id — have them re-check the Admin UI. Print the `equivalent.ui` path.\n\n3. **Spawn the local runner.** Call `self_hosted_runner_spawn_local({secret_file_path: './runner-setup/ENVIRONMENT_SECRET', capacity: 1})`. Print the returned `command` so the operator sees the exact CLI invocation they'd use in production. Then call `self_hosted_runner_read_health` once to confirm `status:\"ok\"`; if unreachable, `self_hosted_runner_tail_log` and surface the first error line.\n\n4. **Watch the Admin UI flip from 0 → 1 alive.** Poll `self_hosted_runner_get_pool({pool_id})` every ~3 seconds (max ~30s) until `alive_runner_count > 0`. Also call `self_hosted_runner_list_runners({pool_id})` once to show the runner row (lease_expires_at, client_label). Tell the operator to refresh the self-hosted environments page — they'll see \"1 alive\". **This is the moment of proof.**\n\n5. **Point them at /code.** *\"Go to " +
  PH_E +
  '/code — your environment is in the environment picker (look for **Self-hosted environments**). Select it and start a session; it runs on **this** machine."*\n\n## Phase 2 — Teach the surface (narration only)\n\nWalk them through where each surface lives in the Admin UI. **No required operator action** — this is orientation. Do NOT call any tools in this phase (the UI is the lesson):\n\n- **Self-hosted environments** section in Settings → Claude Code. Don\'t click "Self-hosted cloud environments" if you see it — that\'s the earlier environment-profile flow, not this one.\n- **Runners tab**: the runner you just started, with its lease + assigned-session count. **Force-kill** is here for stuck runners.\n- **Keys tab**: where environment secrets are issued and revoked. Explain rotation: mint a new secret, deploy it to runners, revoke the old one.\n- **Queue tab**: sessions waiting on this environment, with **Retry** to requeue a stuck one.\n- **Diagnostic banners** at the top of the environment page surface unplaceable sessions and stale leases — that\'s where the product tells them something\'s wrong.\n\n## Phase 3 — Graduation\n\n- **Recap card.** Print a compact "what we did, in your terms" — each step\'s UI path.\n- **Cheat sheet.** Write `./runner-setup/CHEAT-SHEET.md` containing:\n  - The exact `command` returned by `self_hosted_runner_spawn_local` (space-separated flags; `--flag=value` does NOT work; always pass `--base-dir`).\n  - UI map: Settings → Claude Code → Self-hosted environments → {Overview, Runners, Keys, Queue}.\n  - Prometheus: `http://<host>:{health-port}/metrics` and the gauge names.\n  - "If something breaks: run `claude self-hosted-runner doctor`."\n  - "For production: see the operator guide PDF (Kubernetes / Docker Compose recipes — assumes no disk state persists between restarts)."\n- **Stop the local runner.** Bash `kill $(cat ./runner-setup/runner.pid)` (or the pid the spawn tool returned), then re-poll `self_hosted_runner_get_pool` and tell the operator to refresh the Admin UI — the alive count drops back to 0. Closes the loop on lifecycle.\n\n**Exit criterion:** the operator has seen their runner appear in the Admin UI **and** `./runner-setup/CHEAT-SHEET.md` exists on disk.\n\nProduction deployment is **taught, not tooled** — there is no `deploy_to_k8s` tool. If asked, explain the k8s/compose pattern and Write a sample manifest; the operator owns their orchestrator.'

const DOCTOR_PROMPT_TEMPLATE =
  'You are diagnosing a **self-hosted runner** deployment for Claude Code on the web. Work through the diagnostic categories below, gather evidence with the typed `self_hosted_runner_*` read tools (admin-API state, `/healthz`, `/metrics`, redacted log tail) and Bash for everything else, fix what you can, and escalate cleanly when you can\'t.\n\n## Step 0 — Detect context\n\nFigure out where you\'re running and what you can reach:\n\n- **On the runner host?** `self_hosted_runner_read_health` returns `{health:{…}}`. You can `self_hosted_runner_tail_log` the runner\'s `--log-file` directly, and `self_hosted_runner_read_metrics` gives a point-in-time gauge snapshot without parsing the log.\n- **On an operator laptop?** `self_hosted_runner_read_health` returns `{unreachable:true}`, but `kubectl` / `docker` are available via Bash. Logs come via `kubectl logs` / `docker logs`.\n- **Admin API access?** The typed admin-API tools throw "Not logged in" if there\'s no `claude login` OAuth session. Without it, you\'re limited to local evidence — say so, and tell the operator to run `claude login` if you need server-side state. (`ANTHROPIC_API_KEY` does **not** work for these endpoints — OAuth only.)\n\nAsk the operator: **"What\'s the symptom?"** — or scan the runner log, `/healthz`, and admin API yourself to classify it into one of the nine categories below. If you can\'t classify it, gather everything non-destructively, generate the bundle (below), and present your best hypothesis alongside it.\n\n## Diagnostic categories\n\nEach row: **signature** (what the operator or logs show) → **check** → **root cause** → **fix**. Work the relevant category; cross-reference when a signature points elsewhere (e.g. `alive_runner_count == 0` in §5 → go to §1/§2).\n\n### 1. Auth chain (4-token model: environment secret → runner_token → session_token → inference)\n\n| Signature | Check | Root cause | Fix |\n|---|---|---|---|\n| `[runner:fatal] RegisterRunner auth failed — environment secret invalid or revoked` | Bash `curl -sS -H "Authorization: Bearer $(cat <environment-secret-file>)" "' +
  PH_E +
  "/v1/code/runners/self-hosted/runners/register\" -X POST -d '{}'` | environment secret revoked or wrong | Re-issue in Admin UI → Keys tab; remount on the runner |\n| `RegisterRunner auth failed` but secret was just minted | Decode the secret's `ccr:org_id` claim: `sed 's/^sk-ant-[a-z]*-//' <secret-file> \\| cut -d. -f2 \\| tr '_-' '/+' \\| base64 -d 2>/dev/null \\| jq .` | Secret issued by a *different* org | Use a secret minted from **this** org's environment |\n| Runner fatal at startup before any network call: `ENOENT` / `EACCES` reading environment secret | `ls -l <environment-secret-file> && cat <environment-secret-file> >/dev/null` | Secret file unreadable, missing, or volume mount hung | Fix file perms / re-mount the secret volume |\n| `[runner:fatal] poll auth failed — token expired or revoked. Draining and exiting for clean restart.` after running fine for a while | Check whether the runner restarted cleanly (orchestrator logs / pod restart count) | runner_token TTL hit or was revoked. Runner does **not** self-heal — it drains and exits cleanly so the orchestrator restarts it, which re-registers. | If the restart loop persists across fresh pods, the **environment secret** itself was revoked → re-issue |\n| Child `claude` process fails calling the API | `grep -i 'Authentication failed' <runner.log>` | session_token isn't refreshing | Confirm runner version has the refresh logic; restart the runner |\n| Model calls fail with `403` / `authentication_error` (session_token is fine) | Inference-token path; nothing operator-side to inspect | Inference auth misconfigured for the org | Escalate — this is org-level config on the Anthropic side |\n\n### 2. Network\n\n| Signature | Check | Root cause | Fix |\n|---|---|---|---|\n| `getaddrinfo ENOTFOUND " +
  PH_T +
  '` | `nslookup ' +
  PH_T +
  '` | DNS resolution broken | Fix resolver / `/etc/resolv.conf` / cluster DNS |\n| `connect ETIMEDOUT` / `ECONNREFUSED` | `curl -sI --max-time 5 ' +
  PH_E +
  '/` | Firewall blocks egress on 443 | Allow egress to `' +
  PH_T +
  ':443` |\n| `ECONNRESET` mid-poll | How long was the connection open before reset? | NAT / proxy idle-connection timeout dropping long-lived polls | Raise NAT/proxy idle timeouts |\n| `unable to verify the first certificate` | `openssl s_client -connect ' +
  PH_T +
  ":443 </dev/null` | Corporate TLS interception / missing CA | Install CA bundle; set `NODE_EXTRA_CA_CERTS` |\n| `curl` from the host works but the runner process can't connect | Dump `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` from the runner's env | Proxy env vars set (or missing) on the runner process only | Match proxy env between host and runner |\n| `404` on every API path | `echo $ANTHROPIC_BASE_URL` — compare to expected `" +
  PH_E +
  '` | `ANTHROPIC_BASE_URL` mis-set | Fix or unset `ANTHROPIC_BASE_URL` |\n| `Rate limited (429). Polling too frequently.` on PollWork | Custom poll interval below 5s? Many replicas sharing one environment? | Backend rate-limiting | Restore default poll interval; reduce replica fan-out |\n| Mid-run `poll auth failed` on an otherwise-healthy runner | `date -u` vs `curl -sI ' +
  PH_E +
  "/ \\| grep -i '^date:'` | Runner clock skew throws off the 80%-TTL refresh schedule | Fix NTP on the host |\n\n### 3. Runner lifecycle\n\n| Signature | Check | Root cause | Fix |\n|---|---|---|---|\n| Process exits 0; last log line `account workload drained` | — | Expected — runner was account-locked, that account's last session finished | Orchestrator should restart it |\n| Process exits 0; last log line `[runner:exit] idle <N>min with no work — exiting for autoscaler scale-down` | `--exit-if-unused-min` value | Intended idle exit | Raise/remove `--exit-if-unused-min` |\n| Process exits 0; last log line `[runner:exit] retire time passed and no active sessions` (preceded by `[runner:retire] …` lines) | `--retire-at` / `SELF_HOSTED_RUNNER_RETIRE_AT` value vs the host's kill time | Intended retire exit — active sessions were released (parked, resumable) before the host's hard kill | Expected; if sessions are still dying at the host kill, move `--retire-at` earlier |\n| `kubectl describe pod` → `OOMKilled` / exit 137 | Pod memory limit vs `--capacity` × child footprint | Runner + N child sessions exceeded the limit | Raise memory limit or lower `--capacity` |\n| Pod evicted / restarted by liveness probe | `kubectl get events`; is `/healthz` reachable from the probe? | Liveness probe targets wrong port/path | Point probe at `GET :{health-port}/healthz` |\n| Sessions killed mid-run during a deploy | `terminationGracePeriodSeconds` vs observed drain time | SIGTERM→SIGKILL before drain finished | Raise `terminationGracePeriodSeconds` |\n\n### 4. Session execution\n\n| Signature | Check | Root cause | Fix |\n|---|---|---|---|\n| `failure_log`: `git clone failed: authentication` | Runner image has git creds? | Git auth missing | Mount creds / inject via `--exec-path` wrapper |\n| `failure_log`: `command not found` | `which <tool>` inside runner image | Tool missing | Install in the image |\n| `failure_log`: `ENOSPC` | `df -h` on runner host | Disk full | Clean `--base-dir` / mount larger volume |\n| Child `claude` exits immediately, no output | Inspect `--exec-path` wrapper | Wrapper broken | `chmod +x`; test standalone |\n| Session aborted after N min wall-clock | `--kill-session-after-min` value | Max-lifetime watchdog fired on a single child session | Raise if too aggressive |\n| `[runner:session] <sid> no child output for <N> — releasing` | `--startup-timeout-min` value (default 15) | Startup-timeout clock fired — child produced no output (slow MCP connect / large `--resume` hydration / no pending input) | Raise `--startup-timeout-min` or set `0` to disable |\n| `failure_log`: `Another runner has taken over this session` (409) | Network blips / long pauses before? | Lease expired, another runner claimed it | Usually self-resolves |\n| Session shows **Stuck** in Queue tab (`excluded_runner_ids` length ≥ 3) | `self_hosted_runner_list_sessions` → check `failure_log` + `excluded_runner_ids` | Failed on 3 different runners — usually the session, not the infra | Investigate the session; if you've confirmed the infra is healthy and want to retry on a fresh runner, `self_hosted_runner_requeue_session({session_id, runner_id})` clears the block (pass the last runner in excluded_runner_ids as runner_id) |\n| `EACCES` writing to base-dir | `ls -ld $BASE_DIR`; `id` | Wrong UID | Fix ownership or point `--base-dir` at a writable path |\n\n### 5. Queue / placement\n\n| Signature | Check | Root cause | Fix |\n|---|---|---|---|\n| Sessions stay **Queued** forever; runners alive | `get_pool` → `unplaceable_session_count > 0`; `list_runners` → every `locked_account_id` set | All runners account-locked to *other* users | Scale up; or wait for locked runners to drain |\n| Queued; `available_capacity_total == 0` | Runner `--capacity` vs `active_sessions` | At capacity | Scale up replicas or raise `--capacity` |\n| Queued; `pending_session_count == 0` on this environment | List **all** environments and their `pending_session_count` | Session created against a *different* environment | Point user at the right environment |\n| Queued; `alive_runner_count == 0` | — | No runners at all | Go to §1/§2/§3 |\n| Queued (autoscaling environment); `get_pool` → `circuit_broken_count > 0` or `backing_off_count > 0` | — | spawn-runner hook failing — sessions are paused/backing off, not unplaceable | Go to §9 rows 6–7 |\n\n### 6. Version / compatibility\n\n| Signature | Check | Root cause | Fix |\n|---|---|---|---|\n| `runner version <X> is below minimum <Y>` | `claude --version` vs server floor | Runner build too old | Update the self-hosted-runner build |\n| Unexpected 400s / fields missing from responses | Runner version vs current release | Backend rolled forward past this runner | Update the build |\n\n### 7. Observability gaps\n\n| Signature | Fix |\n|---|---|\n| No `--log-file` set | Restart with `--log-file /var/log/self-hosted-runner.log` |\n| `/healthz` unreachable | Check `--health-port`; open firewall |\n| `[runner:warn] /healthz listener failed on port <p>: EADDRINUSE` | Set `--health-port` to a free port |\n| `/metrics` not scraped | Point a `PodMonitor` at the pods; gauges: `claude_code_self_hosted_runner_{capacity,active_sessions,locked_account,last_poll_age_seconds,info}` |\n\n### 8. Webhook\n\nWebhook delivery is in design — Anthropic is gathering input from early-access operators on the payload shape before shipping. If you have requirements, share them with your account team. Until then, use `self_hosted_runner_get_pool` for queue depth.\n\n### 9. Orchestrator (autoscaling)\n\nIf the operator runs `claude self-hosted-runner orchestrator` to consume spawn requests, probe its `/healthz` (default `--health-port` 8080; same port as the runner, so on a shared host check which process owns it). The endpoint **always returns 200** — read the body for state. From an operator laptop, port-forward first: `kubectl port-forward deploy/<orchestrator> 8080`.\n\n```bash\ncurl -s http://localhost:8080/healthz | jq .\n```\n\n| Signature | Check | Root cause | Fix |\n|---|---|---|---|\n| `/healthz` unreachable (`curl` connection refused) | Is the orchestrator process up? `--health-port` set to something other than 8080, or `0`? | Process down, wrong port, or listener disabled | Start it / point at the right port |\n| `\"connected\": false` | `last_error` field in the same body | Can't reach `" +
  PH_T +
  '` (network/DNS/TLS — see §2) or environment secret rejected (see §1) | Fix per the referenced section; the orchestrator exits non-zero on 400/401/403/404/426 so a restart loop here means a permanent config/auth/version problem (400 = invalid request body, usually a flag mismatch) |\n| `"clock_skew_ms"` ≥ 60000 (or ≤ −60000) | `date -u` on the orchestrator host vs `curl -sI ' +
  PH_E +
  "/ \\| grep -i '^date:'` | Host clock drifted; hooks that verify the work-order JWT `exp` will mis-fire | Fix NTP on the host |\n| `\"last_poll_at\"` more than ~60s old while `connected: true` | Orchestrator log for the last `dispatching N hint(s)` line and matching hook completions; `ps`/`kubectl exec` for stuck `spawn-runner` children. (Backoff after poll errors flips `connected: false` first, so it appears on row 2 — not here.) | Poll loop wedged between successful polls on a slow/stuck `spawn-runner` hook (D-state on a hung mount, or a hook that doesn't return within `--hook-timeout`) | Kill the stuck hook; check `hooksDir` mount health; the orchestrator abandons a D-state child after `--hook-timeout` + 2×5s grace. Restart the orchestrator if the log shows no progress |\n| `\"last_error\"` set (non-null) | Read the string — it's either `spawn-runner hook failed: <stderr tail>` or a poll failure (HTTP status or transport error) | Hook script failing / can't reach `" +
  PH_T +
  '` | Fix the hook (run it by hand with a fake `CLAUDE_RUNNER_ORDER_ID`); for poll failures see §2 |\n| `"queue_counts.backing_off" > 0` | `self_hosted_runner_list_sessions` → per-session `spawn_last_error` (sanitized hook stderr) | spawn-runner hook is failing intermittently; each session retries with exponential backoff | Fix the hook; sessions self-recover on the next retry |\n| `"queue_counts.circuit_broken" > 0` | `self_hosted_runner_list_sessions` → per-session `spawn_last_error` | spawn-runner hook failed 5× (or returned non-retryable) for those sessions; they are **paused** and will not be re-offered | Fix the infra (k8s quota, image pull, hook exit code), then for each paused session: Admin UI → Queue tab → **Retry spawn**, or `curl -X POST -H "Authorization: Bearer $OAUTH" "' +
  PH_E +
  "/v1/code/runners/self-hosted/sessions/<session_id>/retry-spawn\" -d '{}'` |\n\nWhen bundling for escalation, also capture `orchestrator-healthz.json` alongside the runner's `healthz.json`.\n\n## Escalation — generate a diagnostic bundle\n\nWhen you can't fix it, or the operator asks to escalate:\n\n1. `TS=$(date -u +%Y%m%dT%H%M%SZ); DIR=./runner-diag-$TS; mkdir -p \"$DIR\"`\n2. Collect (write `\"unreachable\"` / `\"unavailable\"` for anything you can't get):\n   - `healthz.json` — `/healthz` output\n   - `metrics.txt` — `/metrics` output\n   - `runner.log` — last ~64 KB of the `--log-file` or `kubectl logs --tail=1000`\n   - `environment.json`, `runners.json`, `sessions.json` — admin-API responses (if OAuth available)\n   - `versions.txt` — `claude --version`; runner version from `/healthz`; `uname -a`\n   - `config-redacted.txt` — the runner's flags / env, redacted\n   - `DIAGNOSIS.md` — **your own write-up**: symptom, category, what you checked, best hypothesis\n3. **Redact** `runner.log` and `config-redacted.txt` before bundling. Pipe each through:\n\n   ```bash\n   sed -E -e 's/((secret|key|token|password|credential)[^=: ]*[=: ]+)[^ ]+/\\1[REDACTED]/Ig' \\\n          -e 's/sk-ant-[A-Za-z0-9_.-]+/[REDACTED]/g' \\\n          -e 's/(Bearer )[^[:space:]]+/\\1[REDACTED]/Ig'\n   ```\n\n   **Review manually before sharing** — automated redaction is best-effort.\n4. `tar czf runner-diag-$TS.tar.gz -C . runner-diag-$TS && rm -rf \"$DIR\"`\n5. Tell the operator:\n\n   > Diagnostic bundle: `./runner-diag-<ts>.tar.gz`\n   > Please review it (open the tarball — no secrets should be present), then share it with Anthropic via your shared Slack Connect channel or account team.\n\n**Never auto-upload customer logs.** The operator reviews and sends."

/** densable `M9p` — CLAUDE_AI_ORIGIN for setup prompt */
export function resolveClaudeAiOrigin(): string {
  try {
    const cfg = getOauthConfig() as {
      CLAUDE_AI_ORIGIN?: string
      BASE_API_URL?: string
    }
    if (typeof cfg.CLAUDE_AI_ORIGIN === 'string' && cfg.CLAUDE_AI_ORIGIN) {
      return cfg.CLAUDE_AI_ORIGIN.replace(/\/+$/, '')
    }
  } catch {
    /* fall through */
  }
  return 'https://claude.ai'
}

/** densable `JWt` — API base for doctor prompt */
export function resolveDoctorApiBase(): string {
  const e = process.env.ANTHROPIC_BASE_URL?.replace(/\/+$/, '')
  if (e) return e
  try {
    const cfg = getOauthConfig() as { BASE_API_URL?: string }
    if (typeof cfg.BASE_API_URL === 'string' && cfg.BASE_API_URL) {
      return cfg.BASE_API_URL.replace(/\/+$/, '')
    }
  } catch {
    /* fall through */
  }
  return 'https://api.anthropic.com'
}

/** densable `t2h` */
export function buildSetupSystemPrompt(
  origin: string = resolveClaudeAiOrigin(),
): string {
  return SETUP_PROMPT_TEMPLATE.split(PH_E).join(origin)
}

/** densable `i2h` — e = API base URL; t = host */
export function buildDoctorSystemPrompt(
  apiBase: string = resolveDoctorApiBase(),
): string {
  let host: string
  try {
    host = new URL(apiBase).host
  } catch {
    host = apiBase.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
  return DOCTOR_PROMPT_TEMPLATE.split(PH_E).join(apiBase).split(PH_T).join(host)
}

export function formatSetupHelp(): string {
  return `Usage: claude self-hosted-runner setup [args...]
Any extra args are passed to the underlying Claude Code session.`
}

export function formatDoctorHelp(): string {
  return `Usage: claude self-hosted-runner doctor [args...]
Any extra args are passed to the underlying Claude Code session.`
}

export type SetupDoctorSpawnOpts = {
  kind: 'setup' | 'doctor'
  argv: string[]
  execPath?: string
  execArgs?: string[]
  /** inject for tests */
  spawnSyncFn?: typeof spawnSync
}

/**
 * Build child argv for setup/doctor (densable Dqv/Lqv without side-effect inits).
 */
export function buildSetupDoctorChildArgs(
  opts: SetupDoctorSpawnOpts,
): string[] {
  const { kind, argv } = opts
  const prompt =
    kind === 'setup' ? buildSetupSystemPrompt() : buildDoctorSystemPrompt()
  const tools = kind === 'setup' ? SETUP_TOOLS : DOCTOR_TOOLS
  const firstMsg = kind === 'setup' ? SETUP_FIRST_MESSAGE : DOCTOR_FIRST_MESSAGE
  const { execArgs } = resolveExec(opts.execPath)
  const resolvedExecArgs = opts.execArgs ?? execArgs
  // densable: if first arg does not start with `-`, skip default first message
  const first = argv.length > 0 && !argv[0]!.startsWith('-') ? [] : [firstMsg]
  return [
    ...resolvedExecArgs,
    ...first,
    '--append-system-prompt',
    prompt,
    '--tools',
    tools,
    '--permission-mode',
    'default',
    ...argv,
  ]
}

function runWizard(kind: 'setup' | 'doctor', argv: string[]): void {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(kind === 'setup' ? formatSetupHelp() : formatDoctorHelp())
    return
  }
  const childArgs = buildSetupDoctorChildArgs({ kind, argv })
  const label = kind === 'setup' ? 'setup' : 'doctor'
  if (process.env.DEBUG) {
    console.error(
      `[self-hosted-runner:${label}] spawning:`,
      JSON.stringify({
        argv: [
          process.execPath,
          ...childArgs.map(a => (a.length > 200 ? `<${a.length} chars>` : a)),
        ],
      }),
    )
  }
  const result = spawnSync(process.execPath, childArgs, { stdio: 'inherit' })
  if (result.error) {
    console.error(
      `[self-hosted-runner:${label}] failed to spawn child: ${result.error.message}`,
    )
    process.exit(1)
  }
  if ((result.status !== null && result.status !== 0) || result.signal) {
    console.error(
      `[self-hosted-runner:${label}] child exited with status ${result.status ?? '(null)'}${result.signal ? `, signal ${result.signal}` : ''}`,
    )
  } else {
    /* densable success path telemetry omitted */
  }
  const cont =
    kind === 'setup'
      ? '[self-hosted-runner:setup] To continue setup, re-run `claude self-hosted-runner setup` — resuming the session with `claude --resume`/`-c` will not re-enable the setup tools.'
      : '[self-hosted-runner:doctor] To continue diagnosis, re-run `claude self-hosted-runner doctor` — resuming the session with `claude --resume`/`-c` will not re-enable the doctor tools.'
  console.error(cont)
  process.exit(result.status !== null ? result.status : 1)
}

/** densable `Dqv` */
export async function selfHostedRunnerSetupMain(argv: string[]): Promise<void> {
  runWizard('setup', argv)
}

/** densable `Lqv` */
export async function selfHostedRunnerDoctorMain(
  argv: string[],
): Promise<void> {
  runWizard('doctor', argv)
}
