# sandbox.credentials — 官方 v2.1.187 提取结果

## 1. denyWrite 完整路径列表（offset 222186636，`CXq` 函数返回 `scrubSandboxConfig`）

### 函数签名

```js
function CXq() {
  let H = fU?.home ?? yXq.homedir(),
      q = fU?.originalCwd ?? Oq(),
      K = fU?.GITHUB_ACTION_PATH ?? process.env.GITHUB_ACTION_PATH,
      $ = fU?.runnerFileCommandsDir ?? (process.env.GITHUB_ENV ? H8H.dirname(process.env.GITHUB_ENV) : void 0),
      _ = fU?.workspace ?? process.env.GITHUB_WORKSPACE,
      f = _ && H8H.posix.resolve(_) !== H8H.posix.resolve(q)
        ? [`${_}/.git/hooks`, `${_}/.git/config`, `${_}/.git/modules`, `${_}/.git/info/exclude`, `${_}/.gitmodules`, `${_}/.github`]
        : [];
  return {
    filesystem: {
      allowWrite: gH7,
      denyRead: ["/run/docker.sock","/run/containerd/containerd.sock","/run/podman/podman.sock","/run/buildkit/buildkitd.sock","/run/dbus","/run/user"],
      denyWrite: [
        `${H}/.bash_profile`, `${H}/.bashrc`, `${H}/.bash_aliases`,
        `${H}/.bash_login`, `${H}/.bash_logout`, `${H}/.profile`,
        `${H}/.zshrc`, `${H}/.zprofile`, `${H}/.zshenv`,
        `${H}/.zlogin`, `${H}/.zlogout`,
        `${H}/.claude`, `${H}/.claude.json`,
        fU?.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR,
        `${H}/.gitconfig`, `${H}/.config/git`,
        `${H}/.bunfig.toml`, `${q}/bunfig.toml`, `${q}/package.json`,
        ...NXq.map((A) => `${q}/${A}`),
        `${H}/.npmrc`, `${q}/.npmrc`,
        `${H}/.yarnrc`, `${H}/.yarnrc.yml`, `${q}/.yarnrc`, `${q}/.yarnrc.yml`,
        `${H}/.config/pip`, `${H}/.pip`,
        `${q}/package-lock.json`, `${q}/yarn.lock`, `${q}/pnpm-lock.yaml`,
        `${q}/node_modules/.bin`, `${q}/.git/modules`, `${q}/scripts`,
        `${q}/.claude`, `${q}/.github`,
        `${H}/.local/bin`, `${H}/runners`, `${H}/actions-runner`,
        "/tmp/inline-comments-buffer.jsonl",
        ...fU?.pathDirs ?? [],
        $,
        K, K && K.includes("/_actions/") ? K.slice(0, K.indexOf("/_actions/") + 9) : void 0,
        fU?.GITHUB_EVENT_PATH ?? process.env.GITHUB_EVENT_PATH,
        `${H}/.config/gh`, `${H}/.netrc`, `${H}/.ssh`,
        `${q}/.git/hooks`, `${q}/.git/config`, `${q}/.gitmodules`, `${q}/.git/info/exclude`,
        ...f
      ].filter((A) => !!A)
    }
  }
}
```

### 模块级常量

```js
NXq = [".env", ".env.local", ".env.development", ".env.development.local",
       ".env.test", ".env.test.local", ".env.production", ".env.production.local"]

gH7 = ["home","root","tmp","var","opt","run","mnt"].map((H) => `/${H}`)
```

### `fU`（路径上下文对象）字段

由 `SXq()`（`assertScrubSandboxAvailable`）异步初始化：

```js
fU = {
  home: H,                                        // yXq.homedir()
  originalCwd: Oq(),                              // 原始 cwd
  claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
  runnerFileCommandsDir: K,                       // GITHUB_ENV dirname
  workspace: $,                                   // GITHUB_WORKSPACE
  GITHUB_ACTION_PATH: process.env.GITHUB_ACTION_PATH,
  GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH,
  pathDirs: (process.env.PATH??"").split(":")
    .map((Y) => Y ? H8H.posix.normalize(Y).replace(/\/+$/,"") : Y)
    .filter((Y) => Y && gH7.some((O) => Y.startsWith(`${O}/`)))
}
```

## 2. NXq 拓展 — `.env*` 文件列表

```js
NXq = [".env", ".env.local",
       ".env.development", ".env.development.local",
       ".env.test", ".env.test.local",
       ".env.production", ".env.production.local"]
```

## 3. denyRead — socket/run 路径

```js
denyRead: ["/run/docker.sock", "/run/containerd/containerd.sock",
           "/run/podman/podman.sock", "/run/buildkit/buildkitd.sock",
           "/run/dbus", "/run/user"]
```

## 4. allowWrite — 系统目录白名单

```js
gH7 = ["/home", "/root", "/tmp", "/var", "/opt", "/run", "/mnt"]
```

## 5. 触发条件 — `YL()`（`isScrubEnabled`）+ `uP1()`（本地 agent 强制）

```js
function YL() {
  if (r76 === void 0) r76 = uH(process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB);
  return r76
}

function uP1() {
  if (YL()) return !0;
  if (c4(process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB)) return !1;
  return process.env.CLAUDE_CODE_ENTRYPOINT === "local-agent"
}
```

## 6. UP1 — 敏感环境变量列表（从 subprocess env 中删除）

```js
UP1 = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN",
       "ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_AWS_API_KEY",
       "ANTHROPIC_BEDROCK_MANTLE_API_KEY", "ANTHROPIC_CUSTOM_HEADERS",
       "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_BEARER_TOKEN_BEDROCK",
       "GOOGLE_APPLICATION_CREDENTIALS", "AZURE_CLIENT_SECRET",
       "AZURE_CLIENT_CERTIFICATE_PATH",
       "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL",
       "ACTIONS_RUNTIME_TOKEN", "ACTIONS_RUNTIME_URL",
       "ALL_INPUTS", "OVERRIDE_GITHUB_TOKEN", "DEFAULT_WORKFLOW_TOKEN",
       "SSH_SIGNING_KEY"]
```

## 7. awsCredentialExport + awsAuthRefresh（offset 221026766 / 221025952）

### fYq / AYq / zYq / YYq — 配置读取 + 信任范围检测

```js
function fYq() { return (GK() || {}).awsAuthRefresh }            // getAwsAuthRefresh
function AYq() {                                                 // isAwsAuthRefreshFromProjectOrLocal
  let H = fYq(); if (!H) return !1;
  let q = R6("projectSettings"), K = R6("localSettings");
  return q?.awsAuthRefresh === H || K?.awsAuthRefresh === H
}
function zYq() { return (GK() || {}).awsCredentialExport }       // getAwsCredentialExport
function YYq() {                                                 // isAwsCredentialExportFromProjectOrLocal
  let H = zYq(); if (!H) return !1;
  let q = R6("projectSettings"), K = R6("localSettings");
  return q?.awsCredentialExport === H || K?.awsCredentialExport === H
}
```

### Pt9 — awsAuthRefresh 主入口（offset 221025357）

```js
async function Pt9() {
  let H = fYq(), q = azq;
  if (!H) return !1;
  if (AYq()) {
    if (!T5() && !Rq()) {                          // !isTrusted() && !isTrustBypassed()
      let $ = Error(`Security: awsAuthRefresh executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`);
      return um("awsAuthRefresh invoked before trust check", $),   // logError
             c("tengu_awsAuthRefresh_missing_trust", {}),           // telemetry
             !1
    }
  }
  if (HTH) return HTH;                              // 已缓存的成功结果
  try {
    return N("Fetching AWS caller identity for AWS auth refresh command"),
           await hz$(),                              // STS GetCallerIdentity 探测
           N("Fetched AWS caller identity, skipping AWS auth refresh command"),
           !1
  } catch {
    if (HTH) return HTH;
    if (jH6 !== null && Date.now() - jH6 < Dt9) return !1;   // 30s cooldown（Dt9=30000）
    return HTH = (async () => {
      try { return await YE$(H) }
      finally { if (q === azq) jH6 = Date.now(); HTH = null }
    })(),
    HTH
  }
}
```

### YE$ — awsAuthRefresh 命令执行（offset 221025952）

```js
function YE$(H) {
  N("Running AWS auth refresh command");
  let q = GV.getInstance();                         // AuthRefreshStatus 单例
  return q.startAuthentication(),
         new Promise((K) => {
           let $ = qYq.exec(H, { timeout: Wt9 });   // Wt9 = 180000（3 分钟）
           $.stdout.on("data", (_) => {
             let f = _.toString().trim();
             if (f) q.addOutput(f), N(f, { level: "debug" })
           }),
           $.stderr.on("data", (_) => {
             let f = _.toString().trim();
             if (f) q.setError(f), N(f, { level: "error" })
           }),
           $.on("close", (_, f) => {
             if (_ === 0)
               N("AWS auth refresh completed successfully"),
               q.endAuthentication(!0),
               K(!0);
             else {
               let z = f === "SIGTERM"
                 ? P8.red("AWS auth refresh timed out after 3 minutes. Run your auth command manually in a separate terminal.")
                 : P8.red("Error running awsAuthRefresh (in settings or ~/.claude.json):");
               console.error(z),
               q.endAuthentication(!1),
               K(!1)
             }
           })
         })
}
```

### Xt9 — awsCredentialExport 主入口（offset 221026766）

```js
async function Xt9() {
  let H = zYq(); if (!H) return null;
  if (YYq()) {
    if (!T5() && !Rq()) {                          // !isTrusted() && !isTrustBypassed()
      let K = Error(`Security: awsCredentialExport executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`);
      return um("awsCredentialExport invoked before trust check", K),
             c("tengu_awsCredentialExport_missing_trust", {}),
             null
    }
  }
  try {
    N("Running AWS credential export command");
    let q = await _0(H, { reject: !1 });
    if (q.exitCode !== 0 || !q.stdout)
      throw Error("awsCredentialExport did not return a valid value");
    let K = U8(q.stdout.trim());                    // JSON.parse
    if (!Ez$(K))
      throw Error("awsCredentialExport did not return valid AWS STS output structure");
    return N("AWS credentials retrieved from awsCredentialExport"),
           {
             accessKeyId:     K.Credentials.AccessKeyId,
             secretAccessKey: K.Credentials.SecretAccessKey,
             sessionToken:    K.Credentials.SessionToken,
           }
  } catch (q) {
    let K = P8.red("Error getting AWS credentials from awsCredentialExport (in settings or ~/.claude.json):");
    if (q instanceof Error) console.error(K, q.message);
    else console.error(K, q);
    return null
  }
}
```

### Ez$ — AWS STS 输出结构验证器（offset 220240946）

```js
function Ez$(H) {
  if (!H || typeof H !== "object") return !1;
  let q = H;
  if (!q.Credentials || typeof q.Credentials !== "object") return !1;
  let K = q.Credentials;
  return typeof K.AccessKeyId     === "string" &&
         typeof K.SecretAccessKey === "string" &&
         typeof K.SessionToken    === "string" &&
         K.AccessKeyId.length     > 0 &&
         K.SecretAccessKey.length > 0 &&
         K.SessionToken.length    > 0
}
```

### 相关常量（offset 221048050）

```js
Wt9 = 180000    // awsAuthRefresh timeout（3 分钟）
Gt9 = 180000    // gcpAuthRefresh timeout（3 分钟）
Dt9 = 30000     // awsAuthRefresh cooldown（30 秒）
```

### 触发条件

- `T5()` = `isTrusted()` — workspace 信任已确认
- `Rq()` = `isTrustBypassed()` — 信任检查被绕过（如 CLI flag、内嵌场景）
- `AYq()` / `YYq()` — 配置来自 projectSettings/localSettings（而非 userSettings/policySettings），需要信任检查
- 信任未确认 + 配置来自项目/本地 → 拒绝执行 + 上报 telemetry + logError

## 8. managed-settings-only restriction keys（offset 219248230）

### Zod schema 字段

```js
allowManagedHooksOnly: h.boolean().optional()
  .describe("When true (and set in managed settings), only hooks from managed settings run. User, project, and local hooks are ignored."),

allowManagedPermissionRulesOnly: h.boolean().optional()
  .describe("When true (and set in managed settings), only permission rules (allow/deny/ask) from managed settings are respected. User, project, local, and CLI argument permission rules are ignored."),

allowManagedMcpServersOnly: h.boolean().optional()
  .describe("When true (and set in managed settings), allowedMcpServers is only read from managed settings. deniedMcpServers still merges from all sources, so users can deny servers for themselves. Users can still add their own MCP servers, but only the admin-defined allowlist applies."),

allowAllClaudeAiMcps: h.boolean().optional()
  .describe("When true (and set in managed settings), claude.ai cloud MCP connectors load alongside managed-mcp.json instead of being suppressed by its exclusive-control lockdown. Default off preserves the lockdown. Read from managed settings only."),

strictPluginOnlyCustomization: h.preprocess(
  (q) => Array.isArray(q) ? q.filter((K) => gYH.includes(K)) : q,
  h.union([h.boolean(), h.array(h.enum(gYH))])
).optional().catch(void 0)
  .describe('When set in managed settings, blocks non-plugin customization sources for the listed surfaces. Array form locks specific surfaces (e.g. ["skills", "hooks"]); `true` locks all four; `false` is an explicit no-op. Blocked: ~/.claude/{surface}/, .claude/{surface}/ (project), settings.json hooks, .mcp.json. NOT blocked: managed (policySettings) sources, plugin-provided customizations. Composes with strictKnownMarketplaces for end-to-end admin control — plugins gated by marketplace allowlist, everything else blocked here.'),

// strictKnownMarketplaces: 单独的字段，offset 219248819 / 111672744
```

### gYH surface 列表（offset 219268327）

```js
gYH = ["skills", "agents", "hooks", "mcp"]
```

### or6 — managed-settings-only 传播逻辑（offset 219289300）

```js
function or6(H, q) {                                // propagateManagedSettings
  let K = {};
  if (H.allowManagedHooksOnly          === !0) K.allowManagedHooksOnly          = !0;
  if (H.allowManagedMcpServersOnly     === !0) K.allowManagedMcpServersOnly     = !0;
  if (H.allowManagedPermissionRulesOnly=== !0) K.allowManagedPermissionRulesOnly= !0;
  let $ = H.strictPluginOnlyCustomization;
  if ($ === !0 || Array.isArray($) && $.length > 0) K.strictPluginOnlyCustomization = $;
  if (H.deniedMcpServers) K.deniedMcpServers = H.deniedMcpServers;
  if (q.forceLoginOrgUUID === void 0 && H.forceLoginOrgUUID)
    K.forceLoginOrgUUID = H.forceLoginOrgUUID;
  if (q.allowedMcpServers === void 0 && H.allowedMcpServers)
    K.allowedMcpServers = H.allowedMcpServers;
  if (H.permissions) {
    let _ = uF8(H.permissions, ["deny", "ask"]);
    if (H.permissions.disableBypassPermissionsMode === "disable")
      _.disableBypassPermissionsMode = "disable";
    if (q.allowManagedPermissionRulesOnly !== !0) {
      let { allow: f, additionalDirectories: A } = H.permissions;
      if (f && q.sandbox?.network?.allowManagedDomainsOnly !== !0) _.allow = f;
      if (A) _.additionalDirectories = A
    }
    if (Object.keys(_).length > 0) K.permissions = _
  }
  if (H.sandbox) {
    let { network: _, filesystem: f } = H.sandbox, A = {};
    if (H.sandbox.enabled                   === !0) A.enabled                   = !0;
    if (H.sandbox.failIfUnavailable         === !0) A.failIfUnavailable         = !0;
    if (H.sandbox.allowUnsandboxedCommands  === !1) A.allowUnsandboxedCommands  = !1;
    if (H.sandbox.autoAllowBashIfSandboxed  === !1) A.autoAllowBashIfSandboxed  = !1;
    if (_) {
      let z = uF8(_, ["deniedDomains"]);
      if (_.allowManagedDomainsOnly === !0) z.allowManagedDomainsOnly = !0;
      if (q.sandbox?.network?.allowManagedDomainsOnly !== !0 && _.allowedDomains)
        z.allowedDomains = _.allowedDomains;
      if (Object.keys(z).length > 0) A.network = z
    }
    if (f) {
      let z = uF8(f, ["denyRead", "denyWrite"]);
      if (f.allowManagedReadPathsOnly === !0) z.allowManagedReadPathsOnly = !0;
      // ... 同样的 allowManagedReadPathsOnly 短路逻辑
      if (Object.keys(z).length > 0) A.filesystem = z
    }
    // ...
  }
  return K
}
```

### GJ8 — allowAllClaudeAiMcps 运行时检查（offset 224686738）

```js
function GJ8() {                                    // shouldSuppressClaudeAiMcps
  if (!bo()) return !1;                             // isManagedMcpLockdownEnabled
  if (p7H().some((H) => H.allowAllClaudeAiMcps === !0)) return !1;
  return !0
}
```

### vc1 — allowManagedMcpServersOnly 运行时检查

```js
function vc1() {                                    // isMcpAllowlistManagedOnly
  return R6("policySettings")?.allowManagedMcpServersOnly === !0
}
```

### strictKnownMarketplaces 运行时检查（offset 119364311）

```js
// 错误消息模板：
`Plugins from / are blocked by your organization's managed settings (strictKnownMarketplaces or blockedMarketplaces). Ask your administrator to add {"source":"skills-dir"} to strictKnownMarketplaces, or remove it from blockedMarketplaces.`
```
