# Claude Code

[![GitHub Stars](https://img.shields.io/github/stars/claude-code/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/claude-code/claude-code/stargazers)
[![GitHub Contributors](https://img.shields.io/github/contributors/claude-code/claude-code?style=flat-square&color=green)](https://github.com/claude-code/claude-code/graphs/contributors)
[![GitHub Issues](https://img.shields.io/github/issues/claude-code/claude-code?style=flat-square&color=orange)](https://github.com/claude-code/claude-code/issues)
[![GitHub License](https://img.shields.io/github/license/claude-code/claude-code?style=flat-square)](https://github.com/claude-code/claude-code/blob/main/LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/claude-code/claude-code?style=flat-square&color=blue)](https://github.com/claude-code/claude-code/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)

> Which Claude do you like? The open source one is the best.

本项目是基于官方 Claude Code CLI 工具进行源码还原、工程化重建与能力增强的开源项目。目标是在保留 Claude Code 交互体验的基础上，补齐多模型接入、远程控制、ACP、群控、MCP、插件、KAIROS 常驻助手、Buddy agent 宠物、可观测性与本地自动化等能力。

| 特性                        | 说明                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Claude 群控技术**         | Pipe IPC 多实例协作：同机 main/sub 自动编排 + LAN 跨机器零配置发现与通讯，`/pipes` 选择面板 + `Shift+↓` 交互 + 消息广播路由 |
| **ACP 协议一等一支持**      | 支持接入 Zed、Cursor 等 IDE，支持会话恢复、Skills、权限桥接                                                                  |
| **Remote Control 私有部署** | Docker 自托管远程界面, 可以手机上看 CC                                                                                       |
| **Langfuse 监控**           | 企业级 Agent 监控, 可以清晰看到每次 agent loop 细节, 可以一键转化为数据集                                                    |
| **Web Search**              | 内置网页搜索工具, 支持 bing 和 brave 搜索                                                                                    |
| **Poor Mode**               | 穷鬼模式，关闭记忆提取和键入建议,大幅度减少并发请求，`/poor` 可以开关                                                       |
| **KAIROS 常驻助手**         | 持久化 AI 助手模式，支持 brief 输出、后台等待、频道消息、每日记忆日志、PR 订阅与推送通知等主动 Agent 能力                    |
| **Buddy Agent 宠物**        | 终端里的 AI 伙伴/宠物系统，支持 `/buddy` 唤出、陪伴展示、互动摸摸、上下文反应与提示输入联动                                  |
| **Channels 频道通知**       | MCP 服务器推送外部消息到会话（飞书/Slack/Discord/微信等），`--channels plugin:name@marketplace` 启用                         |
| **自定义模型供应商**        | OpenAI/Anthropic/Gemini/Grok 兼容（`/login`）                                                                                 |
| Voice Mode                  | 语音输入，支持豆包语言输入（`/voice doubao`）                                                                                |
| Computer Use                | 屏幕截图、键鼠控制                                                                                                           |
| Chrome Use                  | 浏览器自动化、表单填写、数据抓取                                                                                             |
| Sentry                      | 企业级错误追踪                                                                                                               |
| GrowthBook                  | 企业级特性开关                                                                                                               |
| /dream 记忆整理             | 自动整理和优化记忆文件                                                                                                       |

## 项目定位

当前主线已融合 `core-clean` 的 Agent Core / runtime 分层。这个项目不再只是一个反编译 CLI 的功能堆叠，而是面向终端交互、headless 嵌入、direct-connect、server、bridge、daemon、ACP 和远程控制场景的 AI coding runtime。

当前目标不是继续围绕单一 CLI 入口做大规模堆叠，而是：

- 保持 CLI / REPL 作为官方交互宿主
- 将可复用执行能力下沉到 `src/core` / `AgentSession`
- 让外部宿主通过 Agent Core 事件和 host adapter 接入
- 保留本项目已有的多模型、群控、KAIROS、Buddy、Remote Control、ACP、MCP、插件与可观测性能力
- 在不破坏主链行为的前提下持续收口 runtime 能力

## Core-Clean 增强对比

相比旧结构，这次融合后增强点主要是：

| 方向 | 旧结构 | 当前结构 |
| ---- | ------ | -------- |
| 执行主链 | CLI / REPL / server 各自直接接入 query lifecycle | `src/core` 提供 `AgentSession.stream()` 与 `AgentEvent` 主链 |
| 宿主接入 | headless、ACP、bridge、server 各自维护适配逻辑 | `src/hosts/*` 统一承接 CLI、headless、REPL、server、remote-control、daemon、terminal |
| runtime 能力 | 分散在入口、server、bridge、工具注册与状态模块中 | `src/runtime/capabilities/*` 收口 execution、server、bridge、daemon、mcp、persistence、tools、commands |
| 外部嵌入 | 主要依赖 CLI 或 REPL 行为 | `./core` 包级入口为 headless embedding / direct-connect / server host 打基础 |
| 事件协议 | SDKMessage、stream-json、UI state、server packet 混在各宿主里 | `AgentEvent` 作为 core event contract，宿主再投影为 stdout、Ink、ACP、WebSocket/SSE |
| 工具体系 | 工具列表直接面向当前入口装配 | runtime tool catalog 保留现有工具，同时提供统一描述、策略与过滤入口 |

## 当前能力

- 交互式 CLI / REPL
- headless runtime session
- direct-connect / server
- ACP agent 模式
- bridge / remote-control / daemon host
- MCP、channels、plugins
- OpenAI / Anthropic / Gemini / Grok 兼容模型接入
- Buddy agent 宠物、KAIROS 常驻助手、Coordinator、task、subagent、team 主链
- computer-use / chrome bridge / remote-control 相关能力
- Langfuse、Sentry、GrowthBook 等可观测性与企业集成能力

## 使用 Agent Core

当前包级 core 入口已经通过 `package.json` 的 `./core` 子路径暴露：

```ts
import { createAgent } from 'claude/core'
```

仓库内部的 headless、ACP、direct-connect、server、bridge、daemon 等场景正在向 `src/core`、`src/hosts` 与 `src/runtime` 收口。外部接入不建议直接建立在 `src/screens/REPL.tsx` 上，优先选择下面这些方向：

- headless embedding
- direct-connect client
- server host
- bridge / remote-control host
- daemon worker
- ACP / IDE agent host

## 项目结构

- [`src/entrypoints/cli.tsx`](src/entrypoints/cli.tsx)
  - CLI 入口与快速路径分发
- [`src/entrypoints/core.ts`](src/entrypoints/core.ts)
  - 包级 Agent Core 入口
- [`src/core`](src/core)
  - Agent Core session / turn / event 主链
- [`src/runtime/capabilities/execution/SessionRuntime.ts`](src/runtime/capabilities/execution/SessionRuntime.ts)
  - 现有 query lifecycle 的 runtime execution asset
- [`src/runtime`](src/runtime)
  - 内部 runtime capability 层
- [`src/hosts`](src/hosts)
  - CLI、headless、REPL、server、remote-control、daemon、terminal 等宿主适配层
- [`src/main.tsx`](src/main.tsx)
  - CLI 启动装配与模式分发
- [`src/screens/REPL.tsx`](src/screens/REPL.tsx)
  - 官方终端交互宿主
- [`src/query.ts`](src/query.ts)
  - turn loop 与 query orchestration

## 开发原则

- CLI 主链优先稳定
- REPL 只做交互宿主，不把执行中枢继续当成重构主战场
- 新宿主优先通过 `src/core` / `AgentSession` / `src/hosts` / `src/runtime` 接入
- 共享行为变更优先补测试
- 不为“结构更优雅”发起高风险重排

- 🚀 [想要启动项目](#-快速开始源码版)
- 🐛 [想要调试项目](#vs-code-调试)
- 📖 [想要学习项目](#teach-me-学习项目)

## ⚡ 快速开始(安装版)

不用克隆仓库, 从 NPM 下载后, 直接使用

```sh
npm i -g claude-code

# bun 安装比较多问题, 推荐 npm 装
# bun  i -g claude-code
# bun pm -g trust claude-code @claude-code/mcp-chrome-bridge

claude # 以 nodejs 打开 claude code
claude-bun # 以 bun 形态打开
claude update # 更新到最新版本
CLAUDE_BRIDGE_BASE_URL=https://remote-control.claude-code.win/ CLAUDE_BRIDGE_OAUTH_TOKEN=test-my-key claude --remote-control # 我们有自部署的远程控制
```

> **安装/更新失败？** 先 `npm rm -g claude-code` 清理旧版本，再 `npm i -g claude-code@latest`。仍失败则指定版本号：`npm i -g claude-code@<版本号>`

## ⚡ 快速开始(源码版)

### ⚙️ 环境要求

一定要最新版本的 bun 啊, 不然一堆奇奇怪怪的 BUG!!! bun upgrade!!!

- 📦 [Bun](https://bun.sh/) >= 1.3.11

**安装 Bun：**

```bash
# Linux 和 macOS
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

**安装后的操作：**

1. **让当前终端识别 `bun` 命令**

   安装脚本会把 `~/.bun/bin` 写入对应的 shell 配置文件。macOS 默认 zsh 环境通常会看到：

   ```text
   Added "~/.bun/bin" to $PATH in "~/.zshrc"
   ```

   可以按安装脚本提示重启当前 shell：

   ```bash
   exec /bin/zsh
   ```

   如果你使用 bash，重新加载 bash 配置：

   ```bash
   source ~/.bashrc
   ```

   Windows PowerShell 用户关闭并重新打开 PowerShell 即可。

2. **验证 Bun 是否可用**

   ```bash
   bun --help
   bun --version
   ```

3. **如果已经安装过 Bun，更新到最新版本**

   ```bash
   bun upgrade
   ```

- ⚙️ 常规的配置 CC 的方式, 各大提供商都有自己的配置方式

### 📍 命令执行位置

- 安装或检查 Bun 的命令可以在任意目录执行：
  `curl -fsSL https://bun.sh/install | bash`、`bun --help`、`bun --version`、`bun upgrade`
- 安装本项目依赖、启动开发模式、构建项目时，必须先进入本仓库根目录，也就是包含 `package.json` 的目录。

### 📥 安装

```bash
cd /path/to/claude-code
bun install
```

### ▶️ 运行

```bash
# 开发模式, 看到版本号 888 说明就是对了
bun run dev

# 构建
bun run build
```

构建采用 code splitting 多文件打包（`build.ts`），产物输出到 `dist/` 目录（入口 `dist/cli.js` + 约 450 个 chunk 文件）。

构建出的版本 bun 和 node 都可以启动, 你 publish 到私有源可以直接启动

如果遇到 bug 请直接提一个 issues, 我们优先解决

### 👤 新人配置 /login

首次运行后，在 REPL 中输入 `/login` 命令进入登录配置界面，选择 **Anthropic Compatible** 即可对接第三方 API 兼容服务（无需 Anthropic 官方账号）。
选择 OpenAI 和 Gemini 对应的栏目都是支持相应协议的

需要填写的字段：


| 📌 字段      | 📝 说明       | 💡 示例                      |
| ------------ | ------------- | ---------------------------- |
| Base URL     | API 服务地址  | `https://api.example.com/v1` |
| API Key      | 认证密钥      | `sk-xxx`                     |
| Haiku Model  | 快速模型 ID   | `claude-haiku-4-5-20251001`  |
| Sonnet Model | 均衡模型 ID   | `claude-sonnet-4-6`          |
| Opus Model   | 高性能模型 ID | `claude-opus-4-6`            |

- ⌨️ **Tab / Shift+Tab** 切换字段，**Enter** 确认并跳到下一个，最后一个字段按 Enter 保存

> ℹ️ 支持所有 Anthropic API 兼容服务（如 OpenRouter、AWS Bedrock 代理等），只要接口兼容 Messages API 即可。

## Feature Flags

所有功能开关通过 `FEATURE_<FLAG_NAME>=1` 环境变量启用，例如：

```bash
FEATURE_BUDDY=1 FEATURE_FORK_SUBAGENT=1 bun run dev
```

## VS Code 调试

TUI (REPL) 模式需要真实终端，无法直接通过 VS Code launch 启动调试。使用 **attach 模式**：

### 步骤

1. **终端启动 inspect 服务**：

   ```bash
   bun run dev:inspect
   ```

   会输出类似 `ws://localhost:8888/xxxxxxxx` 的地址。
2. **VS Code 附着调试器**：

   - 在 `src/` 文件中打断点
   - F5 → 选择 **"Attach to Bun (TUI debug)"**

## Teach Me 学习项目

我们新加了一个 teach-me skills, 通过问答式引导帮你理解这个项目的任何模块。(调整 [sigma skill 而来](https://github.com/sanyuan0704/sanyuan-skills))

```bash
# 在 REPL 中直接输入
/teach-me Claude Code 架构
/teach-me React Ink 终端渲染 --level beginner
/teach-me Tool 系统 --resume
```

### 它能做什么

- **诊断水平** — 自动评估你对相关概念的掌握程度，跳过已知的、聚焦薄弱的
- **构建学习路径** — 将主题拆解为 5-15 个原子概念，按依赖排序逐步推进
- **苏格拉底式提问** — 用选项引导思考，而非直接给答案
- **错误概念追踪** — 发现并纠正深层误解
- **断点续学** — `--resume` 从上次进度继续

### 学习记录

学习进度保存在 `.claude/skills/teach-me/` 目录下，支持跨主题学习者档案。

## Contributors

<a href="https://github.com/claude-code/claude-code/graphs/contributors">
  <img src="contributors.svg" alt="Contributors" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=claude-code%2Fclaude-code&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=claude-code/claude-code&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=claude-code/claude-code&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=claude-code/claude-code&type=date&legend=top-left" />
 </picture>
</a>

## 致谢

- [doubaoime-asr](https://github.com/starccy/doubaoime-asr) — 豆包 ASR 语音识别 SDK，为 Voice Mode 提供无需 Anthropic OAuth 的语音输入方案

## 许可证

本项目仅供学习研究用途。Claude Code 的所有权利归 [Anthropic](https://www.anthropic.com/) 所有。
