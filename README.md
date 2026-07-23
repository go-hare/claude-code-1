# Claude Code（go-hare）

[English README](./README_EN.md)

[![GitHub Stars](https://img.shields.io/github/stars/go-hare/claude-code-1?style=flat-square&logo=github&color=yellow)](https://github.com/go-hare/claude-code-1/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/go-hare/claude-code-1?style=flat-square&color=orange)](https://github.com/go-hare/claude-code-1/issues)
[![Last Commit](https://img.shields.io/github/last-commit/go-hare/claude-code-1?style=flat-square&color=blue)](https://github.com/go-hare/claude-code-1/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)
[![npm](https://img.shields.io/npm/v/@go-hare/claude-code?style=flat-square&logo=npm)](https://www.npmjs.com/package/@go-hare/claude-code)

基于官方 Claude Code CLI 的**源码还原 / 工程化重建**项目。目标是在保留 Claude Code 终端交互体验的同时，补齐多模型接入、自托管 Remote Control、ACP、daemon / 后台会话、MCP、插件与本地自动化等能力。

> 本仓库**不是** Anthropic 官方产品。商标与官方 Claude Code 权利归 [Anthropic](https://www.anthropic.com/) 所有；本项目仅供学习与研究。

| 能力 | 说明 |
| ---- | ---- |
| **多模型** | `/login` 配置 Anthropic / OpenAI / Gemini / Grok 兼容端点 |
| **Remote Control** | 自托管 RCS + Web UI；`claude remote-control` / bridge |
| **ACP** | Agent Client Protocol，可对接 IDE / 代理宿主 |
| **Agents / Daemon** | `claude agents` dashboard、daemon job、后台会话 resume / fork |
| **Fullscreen** | 对齐 densable 滚轮、Jump-to-bottom、alt-screen 等交互 |
| **Poor Mode** | `/poor` 穷鬼模式：跳过记忆提取 / 建议等，降 token |
| **KAIROS / Buddy** | 常驻助手与终端 buddy（feature 可开关） |
| **Computer Use / Chrome** | 截图键鼠、Chrome MCP（平台完整度不一） |
| **Artifacts** | HTML 上传托管（独立 Cloudflare Worker 包） |
| **Voice** | 语音输入（含豆包 ASR 路径） |
| **Web Search** | 内置搜索工具 |
| **Langfuse** | Agent loop 可观测（可选） |

部分能力由 **feature flag** 控制（见下方）；Analytics / GrowthBook / Sentry 等为占位实现，**不要当成可用企业集成**。

---

## 项目定位

这是 **CLI-first** 的 Claude Code 兼容运行时：

- 主交互宿主：`src/screens/REPL.tsx` + `src/main.tsx` / `src/entrypoints/cli.tsx`
- 查询主链：`src/query.ts` / `src/QueryEngine.ts`
- 工具：`packages/builtin-tools`（经 `@claude-code/builtin-tools` 导出）
- 远程 / 守护：`src/bridge/`、`src/daemon/`、`packages/remote-control-server/`
- ACP：`src/services/acp/`、`packages/acp-link/`

仓库里**没有**独立的 `src/core` / `src/hosts` / `src/runtime` 包级 Agent Core 分层；旧文档里的 `createAgent from 'claude/core'`、`./core` 子路径描述已过时，请勿依赖。

近期主线在对齐 **densable 2.1.211** 的 agent / 会话 / 队列 / inbox / daemon 行为（git tag `v2.8.5` 合入前、`v2.8.6` 合入后）。**npm 包版本以 `package.json` / npm 为准**（当前发布线 **2.7.3**），与 git tag 可能不同步。

---

## 安装（npm）

发布包名：**`@go-hare/claude-code`**（平台二进制在 `@go-hare/claude-code-<os>-<arch>` optionalDependencies）。

```sh
npm i -g @go-hare/claude-code

# Windows 若 claude.exe 被占用导致 EBUSY，先结束占用进程再装
# taskkill /F /IM claude.exe

claude                 # 启动（postinstall 落到 bin/）
claude --version
claude agents          # 后台会话 dashboard（需 daemon）
claude update          # 更新

# 自托管 Remote Control 示例（按你的 RCS 改 URL / token）
CLAUDE_BRIDGE_BASE_URL=https://your-rcs.example/ \
CLAUDE_BRIDGE_OAUTH_TOKEN=your-token \
claude --remote-control
```

安装失败时：`npm rm -g @go-hare/claude-code` 后再装 `@latest`（可钉版本 `@2.7.3`）。  
旧文档里的全局包名 `claude-code` **不再**对应本仓库发布流。

---

## 源码开发

### 环境

需要较新的 [Bun](https://bun.sh/)（建议 ≥ 1.3.11）：

```bash
curl -fsSL https://bun.sh/install | bash   # macOS / Linux
# Windows: powershell -c "irm bun.sh/install.ps1 | iex"
bun upgrade
```

### 安装与运行

在**仓库根目录**（含本 `package.json` 的目录）：

```bash
bun install
bun run dev          # 开发模式（MACRO.* 由 scripts/dev.ts 注入）
bun run build        # 代码分割产物 → dist/cli.js + chunks
bun run precheck     # typecheck + biome fix + 全量测试（改完请跑）
```

跨平台二进制与发布：

```bash
bun run build:compile                          # 仅编译当前/指定平台二进制
bun run scripts/publish.ts --build-only        # 同上（publish 脚本路径）
bun run scripts/publish.ts --dry-run           # 构建 + npm publish --dry-run
bun run scripts/publish.ts --with-main         # 含主包 @go-hare/claude-code
```

> 平台包内的 `claude` 二进制由 build 生成，**不应**长期提交进 git。

### `/login` 配置模型

REPL 中 `/login` 可选 Anthropic Compatible / OpenAI / Gemini 等：

| 字段 | 说明 | 示例 |
| ---- | ---- | ---- |
| Base URL | API 地址 | `https://api.example.com/v1` |
| API Key | 密钥 | `sk-xxx` |
| Haiku / Sonnet / Opus | 模型 ID 映射 | 按你的上游填写 |

Tab / Shift+Tab 切字段，Enter 确认。

### Feature Flags

```bash
FEATURE_BUDDY=1 bun run dev
```

构建默认会打开一批 flag（见 `build.ts` / `scripts/defines.ts`）；**默认关闭**的包括 `LAN_PIPES`、`UDS_INBOX`、`FORK_SUBAGENT` 等。群控 / Pipe 相关能力需对应 flag，不要默认当成全开。

### VS Code 调试

TUI 需真实终端，用 attach：

```bash
bun run dev:inspect   # 输出 ws://localhost:… 
```

VS Code F5 → **Attach to Bun (TUI debug)**。

### Teach Me

```text
/teach-me Claude Code 架构
/teach-me React Ink 终端渲染 --level beginner
```

进度在 `.claude/skills/teach-me/`（若已安装该 skill）。

---

## 仓库结构（精简）

| 路径 | 作用 |
| ---- | ---- |
| `src/entrypoints/cli.tsx` | 真入口与快速路径 |
| `src/main.tsx` | Commander CLI 与启动装配 |
| `src/screens/REPL.tsx` | 交互 REPL |
| `src/query.ts` / `QueryEngine.ts` | API 查询与 turn 编排 |
| `packages/builtin-tools/` | 内置工具 |
| `packages/@ant/ink/` | 终端 Ink 框架 |
| `src/bridge/` / `packages/remote-control-server/` | Remote Control |
| `src/daemon/` | 长驻 daemon |
| `src/services/acp/` / `packages/acp-link/` | ACP |
| `scripts/publish.ts` | 平台二进制编译与 npm 发布 |
| `CLAUDE.md` | 给 agent / 贡献者的详细工程说明 |

更完整的架构与测试约定见 [`CLAUDE.md`](./CLAUDE.md)。

---

## Contributors

<a href="https://github.com/go-hare/claude-code-1/graphs/contributors">
  <img src="contributors.svg" alt="Contributors" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=go-hare%2Fclaude-code-1&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/image?repos=go-hare/claude-code-1&type=date&legend=top-left" />
  </picture>
</a>

## 致谢

- [doubaoime-asr](https://github.com/starccy/doubaoime-asr) — 豆包 ASR，Voice Mode 可选路径

## 许可证

仅供学习研究。Claude Code 相关权利归 Anthropic。请遵守上游与依赖的许可条款。
