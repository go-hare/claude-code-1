# v2.1.153 → v2.1.187 P0 特性差异对照报告

本报告覆盖用户指定的 5 个 P0 特性，对比官方 v2.1.187 二进制（`C:\Users\Administrator\AppData\Local\Temp\pkg-latest\package\claude.exe`，235564192 字节）与本地 fork 的差异。所有结论以官方二进制提取的代码为唯一参考。

---

## 1. safe-mode

**结论：官方 v2.1.187 中不存在名为 "safe-mode" 的特性。**

提取证据（见 `safe-mode.raw.md`、`safe-mode-search2.raw.md`）：

- 关键字 `safe mode`、`safe-mode`、`--safe`、`enableSafeMode`、`safeMode:`、`safeModeEnabled` 在二进制内出现的 1 个命中位于 `safe-mode-search2.raw.md` Block 1（offset 232085305），上下文为一段通用验证模板文档字符串：

  ```
  If it writes files / hits a network / deletes things → point it at a
  tmp dir / a mock / a dry-run flag. If there's no safe mode and the
  diff touches the destructive path, say so and verify what you can
  around it.
  ```

  这是文档中的自然语言短语 "safe mode"，不是功能名。整段是一个关于如何验证服务器/API 改动的内部 skill 文档模板，与权限/沙箱/启动模式无关。

- 关键字 `enableSafeMode`、`safeMode:`、`safeModeEnabled`、`--safe` 在二进制中无任何命中。

**fork 当前状态：** fork 也未实现 safe-mode，与官方一致。

**需要的改动：** 无。

---

## 2. fallbackModel

**结论：官方 v2.1.187 实现了完整的 fallback model 机制。fork 已在早期版本中实现。**

官方实现核心证据（见 `fallbackModel.raw.md`，47 个命中块，327 行）：

- 触发遥测事件名：
  - `tengu_api_model_not_found_fallback_triggered`
  - `tengu_api_opus_fallback_triggered`
  - `tengu_model_fallback_triggered`
  - `tengu_refusal_fallback_triggered`

- 系统消息子类型：
  - `model_fallback`（trigger: `model_not_found` | `overloaded`）
  - `model_refusal_fallback`

- 错误类型：`FallbackTriggeredError`（mangled 为 `lXH`）

- 触发条件：当 API 返回 model_not_found 或 overloaded 错误时，自动切换到 fallback 模型并在对话中插入 `model_fallback` 系统消息。

**fork 当前状态：** fork 已实现该特性，分布在：
- `src/cli/agents.ts:33`
- `src/cli/print.ts`
- `src/main.tsx`
- `src/query.ts`
- `src/QueryEngine.ts`
- `src/services/api/claude.ts`
- `src/services/analytics/datadog.ts:43`

**需要的改动：** 后续实现阶段需逐字段对照官方遥测事件 payload 与系统消息结构，确认 fork 的实现与官方完全一致（触发条件、消息格式、错误传播路径）。本报告阶段不展开代码级逐行对比。

---

## 3. Tool(param:value) 权限规则（auto mode 下的 broad-rule 过滤）

**结论：官方 v2.1.187 实现了 auto mode 下对 broad permission rules 的过滤。fork 的 `getAllowRules` 缺失该过滤逻辑。这是已确认的最关键 GAP。**

### 官方实现（`permission-rule4.raw.md`、`permission-rule-broadrule.raw.md`）

核心函数（mangled → 真实含义）：

```js
// auto mode 检测
function PL4(H) {
  return H === "auto" || H === "plan" && (pU5?.isAutoModeActive() ?? !1)
}

// 获取 allow 规则 —— auto mode 下过滤掉 broad rules
function ERH(H) {
  let q = PL4(H.mode)
  return fV6.flatMap((K) =>
    (H.alwaysAllowRules[K] || []).flatMap(($) => {
      let _ = UO($)  // ruleValueFromString
      if (q && NRH(_.toolName, _.ruleContent)) return []  // 过滤 broad rule
      return [{ source: K, ruleBehavior: "allow", ruleValue: _ }]
    })
  )
}

// broad rule 检测（带缓存）
function NRH(H, q) {
  let K = `${H}\x00${q ?? ""}`,
      $ = _L4.get(K)
  if ($ !== void 0) return $
  let _ = rlq(H, q) || olq(H, q) || alq(H, q)
  return _L4.set(K, _), _
}

// Bash broad rule 检测
function rlq(H, q) {
  if (H !== QK) return !1  // QK = Bash tool name
  if (q === void 0 || q === "") return !0
  if (/^[\s*]+$/.test(q)) return !0
  return ov8(q, yw4)
}

// Bash broad pattern 检测：通配符、命令前缀匹配
function ov8(H, q) {
  let K = H.trim().toLowerCase()
  if (K === "*") return !0
  for (let $ of q) {
    let _ = $.toLowerCase()
    if (K === _) return !0
    if (K === `${_}:*` || K === `${_} *`) return !0
    if (K === `${_}*`) return !0
    if (K.startsWith(`${_} `) && K.endsWith("*")) {
      let f = K.slice(_.length + 1)
      if (Ew4.has(_)) { /* curl/wget/kubectl/aws/gcloud/gsutil 特殊处理 */ }
      if (f.startsWith("-")) { /* flag 通配处理 */ }
    }
  }
  return !1
}

// PowerShell broad rule 检测
function olq(H, q) {
  if (H !== F$) return !1  // F$ = PowerShell tool name
  if (q === void 0 || q === "") return !0
  if (/^[\s*]+$/.test(q)) return !0
  let K = q.trim().toLowerCase()
  if (K === "*") return !0
  let $ = [...oT8, "pwsh", "powershell", "cmd", "wsl", "iex",
           "invoke-expression", "icm", "invoke-command", "start-process",
           "saps", "start", "start-job", "sajb", "start-threadjob",
           "register-objectevent", "register-engineevent",
           "register-wmievent", "register-scheduledjob",
           "new-pssession", "nsn", "enter-pssession", "etsn",
           "add-type", "new-object"]
  for (let _ of $) {
    if (K === _) return !0
    if (K === `${_}:*`) return !0
    if (K === `${_}*`) return !0
    if (K === `${_} *`) return !0
    if (K.startsWith(`${_} -`) && K.endsWith("*")) return !0
    // 同时匹配 .exe 变体
    let f = _.indexOf(" "),
        A = f === -1 ? `${_}.exe` : `${_.slice(0, f)}.exe${_.slice(f)}`
    if (K === A) return !0
    if (K === `${A}:*`) return !0
    if (K === `${A}*`) return !0
    if (K === `${A} *`) return !0
    if (K.startsWith(`${A} -`) && K.endsWith("*")) return !0
  }
  return !1
}

// 第三个 broad rule 检测（特定工具类型）
function alq(H, q) {
  return PV(H) === $$  // $$ = 某 tool category identifier
}
```

数据结构：

```js
oT8 = ["python", "python3", "python2", "node", "deno", "tsx", "ruby",
       "perl", "php", "lua", "npx", "bunx", "npm run", "yarn run",
       "pnpm run", "bun run", "bash", "sh", "ssh"]

dgq = [...oT8, "zsh", "fish", "eval", "exec", "env", "xargs", "sudo"]

kZ6 = ["curl", "wget", "kubectl", "aws", "gcloud", "gsutil"]

Ew4 = new Set([...kZ6, ...NZ6])  // 需要特殊处理的命令集

hw4 = {
  kubectl: new Set(["exec", "apply", "create", "delete", "run", "cp",
                    "port-forward", "proxy", "patch", "edit", "replace",
                    "attach", "debug", "scale", "rollout", "drain",
                    "cordon", "taint"]),
  // ...其他（!1 表示无特殊子命令）
}

yw4 = [...dgq, ...[]]  // Bash broad-rule 命令列表
```

### fork 当前实现（`src/utils/permissions/permissions.ts:122-132`）

```ts
export function getAllowRules(
  context: ToolPermissionContext,
): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.alwaysAllowRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'allow',
      ruleValue: permissionRuleValueFromString(ruleString),
    })),
  )
}
```

**GAP：**
1. 缺失 `PL4`（auto mode 检测）
2. 缺失 `NRH`（broad rule 检测，含缓存）
3. 缺失 `rlq`/`ov8`（Bash broad rule）
4. 缺失 `olq`（PowerShell broad rule）
5. 缺失 `alq`（特定工具 broad rule）
6. 缺失数据结构 `oT8`、`dgq`、`kZ6`、`Ew4`、`hw4`、`yw4`
7. `getDenyRules`/`getAskRules` 不需要该过滤（官方 `ZfH`/`hRH` 也未过滤）

### 其他已对齐部分

- `createPermissionRequestMessage`（fork line 137-211）已与官方 `Df` 对齐。
- `getDenyRules`（fork line 213）、`getAskRules`（fork line 223）已与官方 `ZfH`/`hRH` 对齐。

---

## 4. sandbox.credentials

**结论：官方 v2.1.187 二进制中不存在 "sandbox.credentials" 这一字面特性名。该概念由两部分独立机制组成：(a) 沙箱 `denyWrite` 路径保护凭证文件；(b) managed-settings 中的凭证相关配置键。**

### (a) 沙箱 denyWrite 路径保护凭证文件

提取证据（`shell-protect.raw.md` Block 10，offset 222186636）：

```js
{
  filesystem: {
    allowWrite: gH7,
    denyRead: ["/run/docker.sock", "/run/containerd/containerd.sock",
               "/run/podman/podman.sock", "/run/buildkit/buildkitd.sock",
               "/run/dbus", "/run/user"],
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
      `${q}/package-lock.json`
      // ... (后续路径未完整提取)
    ]
  }
}
```

`vD8` 数组（`shell-protect.raw.md` Block 11，offset 222613889）：

```js
vD8 = [".gitconfig", ".gitmodules", ".bashrc", ".bash_profile",
       ".zshrc", ".zprofile", ".profile", ".ripgreprc", ".mcp.json"]
```

`Gwf` 数组（`shell-protect.raw.md` Block 18，offset 230970277）——扩展的凭证/配置文件列表：

```js
Gwf = [".gitconfig", ".gitmodules", ".bashrc", ".bash_profile",
       ".zshrc", ".zprofile", ".profile", ".ripgreprc", ".mcp.json",
       ".claude.json"]
```

### (b) managed-settings 中的凭证相关配置键

提取证据（`sandbox-credentials.raw.md` Block 5，offset 105968271；本次新提取 offset 111670648/113804770）：

settings Zod schema 中存在以下 managed-settings-only 键：

- `awsCredentialExport` — AWS 凭证导出命令
- `awsAuthRefresh` — AWS 认证刷新
- `gcpAuthRefresh` — GCP 认证刷新
- `policyHelper` — 策略辅助
- `apiKeyHelper` — API key 辅助
- `proxyAuthHelper` — 代理认证辅助
- `otelHeadersHelper` — OTel headers 辅助

`awsCredentialExport` 的运行时检查证据（offset 113805288）：

```
Security: awsCredentialExport executed before workspace trust is confirmed.
awsCredentialExport invoked before trust check
tengu_awsCredentialExport_missing_trust
Running AWS credential export command
awsCredentialExport did not return a valid value
awsCredentialExport did not return valid AWS STS output structure
AWS credentials retrieved from awsCredentialExport
Error getting AWS credentials from awsCredentialExport (in settings or ~/.claude.json):
```

即 `awsCredentialExport` 在执行前会检查 workspace trust，未信任时触发 `tengu_awsCredentialExport_missing_trust` 遥测事件并拒绝执行。

其他 managed-settings-only 键（offset 219248230 Zod schema 定义）：

- `allowManagedPermissionRulesOnly` — "When true (and set in managed settings), only permission rules (allow/deny/ask) from managed settings are respected. User, project, local, and CLI argument permission rules are ignored."
- `allowManagedMcpServersOnly`
- `allowManagedHooksOnly`
- `allowAllClaudeAiMcps`
- `strictPluginOnlyCustomization`
- `strictKnownMarketplaces`

### fork 当前状态

- fork 的 `src/utils/settings/types.ts:679` 有 `sandbox: SandboxSettingsSchema().optional()`
- fork 的 `src/utils/sandbox/sandbox-adapter.ts` 有沙箱配置键
- fork **未实现** `awsCredentialExport`/`awsAuthRefresh`/`gcpAuthRefresh`/`policyHelper`/`apiKeyHelper`/`proxyAuthHelper`/`otelHeadersHelper` 这些 managed-settings 键
- fork **未实现** `allowManagedPermissionRulesOnly`/`allowManagedMcpServersOnly`/`allowManagedHooksOnly`/`allowAllClaudeAiMcps`/`strictPluginOnlyCustomization`/`strictKnownMarketplaces` 这些 managed-settings-only 限制键

### 需要的改动

后续实现阶段需要：
1. 扩展沙箱 `denyWrite` 路径列表至与官方一致（含 `.bash_aliases`、`.bash_login`、`.bash_logout`、`.zshenv`、`.zlogin`、`.zlogout`、`.claude`、`.claude.json`、`CLAUDE_CONFIG_DIR`、`.gitconfig`、`.config/git`、`.bunfig.toml`、`bunfig.toml`、`package.json`、`.npmrc`、`.yarnrc`、`.yarnrc.yml`、`.config/pip`、`.pip`、`package-lock.json` 等）
2. 添加 `vD8`/`Gwf` 等扩展凭证文件列表常量
3. 在 settings schema 中新增 managed-settings-only 键（含描述文案需与官方一致）
4. 实现 `awsCredentialExport` 的 trust-check + 遥测事件 (`tengu_awsCredentialExport_missing_trust`)

---

## 5. auto mode dangerous command block + shell startup/config write protection

**结论：官方 v2.1.187 实现了 auto mode 下的危险命令阻止 + shell 启动/配置文件写入保护。fork 已部分实现，需对照细节。**

### (a) auto mode dangerous command block

提取证据（`dangerous-cmd.raw.md`）：

官方在 auto mode 下对 Bash/PowerShell 工具的命令进行危险命令检测，危险命令列表 `oT8`（见上文第 3 节）：

```js
oT8 = ["python", "python3", "python2", "node", "deno", "tsx", "ruby",
       "perl", "php", "lua", "npx", "bunx", "npm run", "yarn run",
       "pnpm run", "bun run", "bash", "sh", "ssh"]

dgq = [...oT8, "zsh", "fish", "eval", "exec", "env", "xargs", "sudo"]
```

该列表既用于 auto mode broad-rule 过滤（第 3 节），也用于 dangerous command 阻止。

### (b) shell startup/config write protection

提取证据（`shell-protect.raw.md` 多块）：

- Block 6（offset 134452214）：sandbox 系统提示中明确指示 "Do not suggest adding sensitive paths like ~/.bashrc, ~/.zshrc, ~/.ssh/*, or credential files to the sandbox allowlist."
- Block 14（offset 224738139）：将 "modifying shell profiles (.bashrc, .profile, .zshrc, PowerShell `$PROFILE`)" 列为 "Unauthorized Persistence" 类别
- Block 17（offset 228360626）：sandbox 系统提示强调 "All commands MUST run in sandbox mode" + 临时文件使用 `$TMPDIR`
- Block 10（offset 222186636）：denyWrite 路径完整列表（见第 4 节）
- Block 15（offset 225782723）：`HWH` 函数返回 shell rc 文件路径：

```js
function HWH(H) {
  let q = H?.homedir ?? qCq.homedir(),
      $ = (H?.env ?? process.env).ZDOTDIR || q
  return {
    zsh: MD6.join($, ".zshrc"),
    bash: MD6.join(q, ".bashrc"),
    fish: MD6.join(q, ".config/fish/config.fish")
  }
}
```

### fork 当前状态

- fork 的 `src/utils/permissions/permissionSetup.ts`（1521 行）有所有危险权限函数
- fork 的 `src/utils/permissions/dangerousPatterns.ts`（80 行）有 `CROSS_PLATFORM_CODE_EXEC` + `DANGEROUS_BASH_PATTERNS`

### 需要的改动

后续实现阶段需要：
1. 对照 `oT8`/`dgq` 危险命令列表是否与 fork 的 `CROSS_PLATFORM_CODE_EXEC` + `DANGEROUS_BASH_PATTERNS` 完全一致
2. 对照 sandbox `denyWrite` 路径（第 4 节已列出）
3. 对照 sandbox 系统提示文案（Block 6/14/17）
4. 确认 fork 是否实现了 `HWH` 等价的 shell rc 文件路径解析函数

---

## 实施优先级建议

| 优先级 | 特性 | 原因 |
|--------|------|------|
| P0-1 | Tool(param:value) auto mode broad-rule 过滤 | 已确认 fork 缺失，影响 auto mode 安全性 |
| P0-2 | sandbox.credentials（denyWrite 路径 + managed-settings 键） | fork 部分实现，需补齐路径列表与 managed-settings 键 |
| P0-3 | auto mode dangerous command block + shell 保护 | fork 已部分实现，需对照细节 |
| P0-4 | fallbackModel 细节对齐 | fork 已实现，需逐字段对照遥测 payload 与消息结构 |
| P0-5 | safe-mode | 无需改动（官方也未实现） |

---

## 提取文件清单

所有提取原始文件位于 `docs/upstream-extraction/v2.1.187/`：

- `safe-mode.raw.md` — safe-mode 关键字搜索
- `safe-mode-search2.raw.md` — safe-mode 二次搜索（确认仅文档短语）
- `fallbackModel.raw.md` — fallback model 完整提取（47 块，327 行）
- `permission-rule.raw.md` ~ `permission-rule4.raw.md` — 权限规则系统（4 个文件）
- `permission-rule-broadrule.raw.md` — broad rule 检测函数
- `permission-rule-only.raw.md` — managed-settings-only 限制键
- `sandbox-credentials.raw.md` — sandbox credentials 搜索（30 块）
- `sandbox-mode.raw.md` — sandbox 模式
- `shell-protect.raw.md` — shell 启动/配置文件保护（50 块）
- `dangerous-cmd.raw.md` — 危险命令阻止

提取工具：`scripts/upstream-extract/extract-one.mjs`（单关键字定位 + N 字节上下文 UTF-8 best-effort 解码）。
