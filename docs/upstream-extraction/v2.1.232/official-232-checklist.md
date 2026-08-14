# densable 2.1.232 — 官方更新清单 × go-hare 对照

> 来源：官方 CHANGELOG / GitHub release **v2.1.232**（**49 条**）。  
> densable SEA：`%TEMP%/official-232/plat/package/claude.exe`（win32-x64）；`// Version: 2.1.232` HIT ×3；size **319026336**；sha256 `ec9e32479bc887809003c91384c6c3a26e7691856d1916f72f6f6d21800f3bd6`。  
> 基线：本地 tip densable **2.1.231**（HAVE 1 + cup/r8o residual）+ npm **2.7.39**。**本 pack 只对齐 2.1.232**。  
> 状态：**HAVE** · **PARTIAL** · **GAP** · **N/A** · **UNKNOWN**  
> 约定：**extract densable first → 1:1**。不自动 commit/push/bump。不 invent gateway-only / Desktop-only。  
> 更新：2026-08-14 — pack 初扫（changelog + win32 SEA + 本地对照）。

## 邻版关系

| 版 | 性质 | go-hare |
| -- | ---- | ------- |
| **2.1.231** | MCP OAuth 预注册 redirect | **已收口** |
| **2.1.232** | fork 默认 / @mention / GitLab / 权限 / RC / sandbox… **49 条** | **本 pack** |
| **2.1.233+** | 未提取 | 勿折入 |

## 初扫计数（2026-08-14）

| 状态 | 约数 | 说明 |
| ---- | ---- | ---- |
| **HAVE**（产品面已有，需逐条 extract 再锁） | ~12–18 | Agent bg 默认、SendMessage bare name、cross-session 配置/入站、部分 PS/GitLab 红action、marketplace 主字段 |
| **PARTIAL** | ~8–12 | FORK 产品默认 OFF（代码有）；GitLab token 家族不全；marketplace **别名**；gitlab marketplace clone 深度未知 |
| **GAP** | ~10–15 | 待 SEA 深 extract + 实现（session unique rename、PS $PSDefault… bypass 金标、Cygwin symlink、nested trust、MCP probe timeout、多项 RC 行为、sandbox.ripgrep 源限制等） |
| **N/A** | ~5–8 | Gateway desktop overlay / managed.policies（go-hare 不发 gateway）；Cowork-only 等 |
| **UNKNOWN** | 其余 | 需对照 SEA 再判 |

> **禁止**把初扫 HAVE 当收口完成度。下表每条须 extract densable → 1:1 后改状态。

## densable 关键符号（SEA 初扫）

| 符号 / 字符串 | 含义 | 本地 |
| --- | --- | --- |
| `// Version: 2.1.232` (×3) | 版本锚 | NEW |
| `FORK_SUBAGENT` | fork 编译门 | 本地 **DEFAULT OFF**（`// 'FORK_SUBAGENT'`） |
| `background by default` | 非 teammate agent 默认 bg | AgentTool `run_in_background !== false` **有** |
| `SendMessage` / bare name resolve | 精确唯一名直送 | `nameResolve` / SendMessageTool **有** |
| `Dialog expiry` / `Messages from your other sessions` | /config 文案 | settings `dialogExpiry` / `crossSessionInbound` **有** |
| `additionalMarketplaces` / `allowedMarketplaces` | settings 别名 | **待证** schema 是否接受别名 |
| `glpat-` / `glrt-` | GitLab 秘钥红action | secretScanner **部分** glpat/gldt |
| `PSDefaultParameterValues` | PS 权限绕过 | powershellSecurity **有相关** |
| `gitlab.com` | marketplace / remote | parseMarketplaceInput 等 **部分** |
| `bwrapPath` / `socatPath` | sandbox 托管二进制 | settings **有**；`sandbox.ripgrep` 源限制 **待证** |

## 全量对照（49 条）

| # | 官方条目（摘要） | 状态 | 本地备注 |
| - | ---------------- | ---- | -------- |
| 1 | Subagent forking **默认开**；`subagent_type:"fork"` 继承会话+cache；交互非 teammate spawn **默认 background** | **PARTIAL** | Agent bg 默认 **HAVE**（`AgentTool` + tests）。**FORK_SUBAGENT 默认 OFF**（defines/CLAUDE）；产品「fork 默认开」需开 DEFAULT_BUILD + densable 门控 extract 再 1:1 |
| 2 | 输入 `@` 按名 mention 另一 Claude 会话 → SendMessage | **UNKNOWN** | 需 PromptInput @-mention 会话名路径 extract |
| 3 | SendMessage 对唯一 live bare name 直送，不先要 ref | **HAVE?** | `nameResolve` + SendMessage 225 面；再对 232 SEA 锁金句 |
| 4 | 同机 interactive 会话名唯一：`name-word-word` 变体 | **GAP?** | SEA 有 `unique names`；本地 /rename 有 collision 逻辑，需 extract 1:1 |
| 5 | `/config`：Dialog expiry + Messages from other sessions | **HAVE?** | `dialogExpiry` / `crossSessionInbound` + PeerInbound UI；config 行文案对齐待证 |
| 6 | GitLab token 红action 全家桶 + glab 与 gh 同级沙箱/路径保护 | **PARTIAL** | `secretScanner` 有 glpat/gldt 等；`glrt-/gloas-/…` 全家桶 + glab 路径保护需 extract |
| 7 | Plugin marketplace 支持 bare `gitlab.com`（含 nested subgroups） | **PARTIAL** | parseMarketplaceInput/gitlab 串有；nested subgroup + 错误文案 1:1 待证 |
| 8 | Settings 别名 `additionalMarketplaces` / `allowedMarketplaces` | **GAP?** | 主字段 `extraKnownMarketplaces` / `strictKnownMarketplaces` 有；**别名**是否进 schema 待证 |
| 9 | Enterprise `blockedMarketplaces` url 对 bare repo git clone 仍拦截 | **UNKNOWN** | 需 policy extract |
| 10 | Gateway desktop: overlay 接受全部 Desktop settings + schema 校验 | **N/A** | go-hare 不发 gateway 控制面 |
| 11 | Gateway managed.policies empty groups / bad email_domain fail boot | **N/A** | 同上 |
| 12 | Fable 5 再进 `/advisor` + usage-credits consent `/model fable` | **UNKNOWN** | 本地有 Fable/advisor residual；232 金标 extract |
| 13 | PS：变量写参不能静默改 `$PSDefaultParameterValues` | **PARTIAL** | powershellSecurity/dangerousCmdlets 有相关；232 金标 extract |
| 14 | Win：Git Bash 跟 Cygwin 符号链接写需权限 | **UNKNOWN** | pathValidation 有 Cygwin 串；extract 1:1 |
| 15 | Nested git 不继承父目录 trust | **UNKNOWN** | 需 trust/git extract |
| 16 | MCP connect：协议版本探测失败/畸形不卡满 30s | **UNKNOWN** | 需 client probe timeout extract |
| 17 | RC：云会话内 bridge 不继承 transcript/credentials | **UNKNOWN** | bridge isolation extract |
| 18 | RC：Desktop/IDE 启动 resume 重附既有 session | **UNKNOWN** | |
| 19 | RC：idle 时新 client 不显示 unreachable | **UNKNOWN** | |
| 20 | RC bridge：worker 重启恢复 history | **UNKNOWN** | |
| 21 | RC：claude.ai 会话已删时 resume 开替换而非 login 失败（227 回归） | **UNKNOWN** | |
| 22 | Cloud gateway `/login` managed settings 失败可感知 | **N/A?** | 无 gateway 产品面时可 N/A |
| 23 | Voice native：连接拒绝立即显示，不卡 listening | **UNKNOWN** | voice residual |
| 24 | mTLS 证书轮换自动 reload | **UNKNOWN** | |
| 25 | 畸形 AWS/Vertex region 回退默认 | **UNKNOWN** | |
| 26 | stream idle timeout Bedrock/Vertex/gateway 可恢复 | **PARTIAL?** | streamKeepAlive 222+ 有；232 部署面 extract |
| 27 | overlay 截断宽度 / start-truncated ellipsis | **UNKNOWN** | Ink |
| 28 | mid-emoji 截断乱字符 | **UNKNOWN** | |
| 29 | known_marketplaces.json 并发写竞态 | **UNKNOWN** | |
| 30 | `/update` `/tui` 不因可存活工作拒绝重启 | **UNKNOWN** | |
| 31 | usage-limit 指引不在 SDK/remote 建议不可用 slash | **UNKNOWN** | |
| 32 | `--advisor fable` consent 文案 | **UNKNOWN** | |
| 33 | fullscreen 长会话不每帧全量 re-normalize | **UNKNOWN** | Messages/VirtualMessageList |
| 34 | managed settings 审批 dialog 改进 + sandbox binary 需批 | **PARTIAL?** | bwrap/socat 字段有；dialog 文案 extract |
| 35 | `/feedback` `/bug` 响应中立即可开 | **UNKNOWN** | |
| 36 | `/plugin install` 先 refresh marketplace | **UNKNOWN** | |
| 37 | `/code-review` high/xhigh/max 也走 bg agent | **HAVE?** | 218 code-review bg；effort 档 extract |
| 38 | 粘贴/剪贴板图非阻塞读 | **UNKNOWN** | imagePaste |
| 39 | RC 断网 ~30min 重连 | **UNKNOWN** | |
| 40 | RC resume 不静默抢同机另一 CC 的 RC | **UNKNOWN** | |
| 41 | agent panel：完成即隐 + `/tasks` footer；overflow 左移 | **UNKNOWN** | |
| 42 | RC 终端说明 takeover/end/delete | **UNKNOWN** | |
| 43 | Bash `< file` 重定向全平台权限检查 | **UNKNOWN** | Bash 权限 |
| 44 | resume 已完成 bg agent 文案缩短 | **UNKNOWN** | |
| 45 | Cowork 不 inline 用户记忆外链 @-import | **N/A?** | Cowork 产品面 |
| 46 | cross-session socket dir：拒 symlink/他人目录 | **PARTIAL?** | UDS 安全面有；232 金标 extract |
| 47 | Linux sandbox protected-path bypass 加固 | **UNKNOWN** | |
| 48 | `sandbox.ripgrep` 仅 user/managed/`--settings`，project 不可覆盖 | **GAP?** | 需 settings 源优先级 extract |
| 49 | 去掉 custom subagent 启动 tip + `/powerup` nudge | **UNKNOWN** | tipRegistry |

## 优先落地顺序（建议）

1. **#8 settings 别名** — 小、schema-only，易 1:1  
2. **#1 FORK 默认 ON** — 产品决策 + DEFAULT_BUILD + densable 门（与历史 OFF 政策冲突，需用户确认是否开）  
3. **#6 GitLab redaction 全家桶 + glab 路径**  
4. **#13–14 PS / Cygwin 安全**  
5. **#3–5 SendMessage / 会话名 / config 文案** 锁 SEA  
6. **RC 簇 #17–21, #39–42** 分批 extract  
7. **Gateway #10–11** 标 N/A 并写进 Explicit non-claims  

## SEA 获取

```text
npm pack @anthropic-ai/claude-code-win32-x64@2.1.232
# → %TEMP%/official-232/plat/package/claude.exe
```

## Explicit non-claims

- **不要**把 231 OAuth 重算进 232。  
- **不要** invent gateway Desktop 控制面。  
- **不要**在未 extract 前把 FORK 默认 ON 当 HAVE。  
- Agent **background 默认** ≠ **fork 默认开**（#1 两句，分判）。
