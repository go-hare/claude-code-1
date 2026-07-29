# Claude in Chrome — 用户操作指南

## 1. 功能简介

Claude in Chrome 让 Claude Code 直接控制你的 Chrome 浏览器。你可以用自然语言让 Claude 帮你：

- 打开网页、导航、前进后退
- 填写表单、上传图片
- 截图、录制 GIF
- 读取页面内容（DOM、纯文本）
- 执行 JavaScript
- 监控网络请求和控制台日志
- 管理标签页

## 2. 前置条件

| 条件 | 说明 |
|------|------|
| 账号 | **本 fork 不强制** claude.ai 订阅；官方 densable 仍要求 Pro/Max/Team。本地 MCP + 扩展即可用 |
| Chrome 浏览器 | 需已安装 Google Chrome |
| Claude in Chrome 扩展 | 从 Chrome Web Store 安装（`claude.ai/chrome`） |
| Claude Code CLI | 已通过 `bun run dev` 或构建产物运行 |

## 3. 启用方式

### Dev 模式

```bash
bun run dev -- --chrome
```

启动后 Claude 会自动检测 Chrome 扩展是否已安装，并注册浏览器控制工具。

### 构建产物

```bash
node dist/cli.js --chrome
```

### 禁用

```bash
bun run dev -- --no-chrome
```

### `/chrome` 菜单（分轨）

REPL 中 `/chrome`：

| 菜单项 | 行为 |
|--------|------|
| **This session: On/Off** | 当前会话热挂载/卸载 `claude-in-chrome` MCP（**不**写全局 default）；On 注入与 `--chrome` 同形的 chrome system prompt，Off 从后续 turn 去掉 |
| **Install Chrome extension** | **官方**：打开 `claude.ai/chrome`（Web Store） |
| **Install local extension** | **本 fork**：从 [go-hare/claude-chrome release](https://github.com/go-hare/claude-chrome/releases/download/claude_1.0.81/claude_1.0.81.zip) **下载 zip** → 解压到 `~/.claude/chrome/extensions/claude_1.0.81` → 打开 `chrome://extensions` 提示 **Load unpacked**（Chrome 不能静默装）。可用 `CLAUDE_CHROME_LOCAL_EXTENSION_ZIP_URL` / `CLAUDE_CHROME_LOCAL_EXTENSION_DIR` 覆盖 |
| **Reconnect extension** | **官方路径**：打开 `clau.de/chrome/reconnect`（Web Store 扩展握手） |
| **Connect local** | **本 fork**：重装 native host + 检测 unpacked；**强制本地 socket**（`CLAUDE_CHROME_FORCE_NATIVE`，**不要 token**）；**不**开 claude.ai；**不**改官方 Reconnect。若 This session 为 Off 则顺带挂载 MCP |
| **Enabled by default: Yes/No** | 仅改 `claudeInChromeDefaultEnabled`，影响**下次**启动；**不**自动挂载/卸载当前 session |

### 通过配置默认启用

在 Claude Code 设置中将 `claudeInChromeDefaultEnabled` 设为 `true`，以后启动无需加 `--chrome` 参数。

## 4. 使用流程

1. **启动 CLI** — 加 `--chrome` 参数启动 Claude Code
2. **确认连接** — REPL 中输入 `/chrome`，查看扩展状态是否显示 "Installed / Connected"
3. **开始对话** — 正常与 Claude 对话，当需要操作浏览器时直接说，例如：
   - "打开 https://example.com 并截图"
   - "在当前页面搜索关键词 xxx"
   - "填写登录表单，用户名 admin"
   - "帮我录制当前操作的 GIF"
4. **权限审批** — 首次执行浏览器操作时，Claude 会请求你的确认
5. **操作完成** — Claude 完成操作后会返回结果（截图、文本、执行结果等）

## 5. 可用操作

### 页面交互

| 操作 | 说明 |
|------|------|
| `navigate` | 导航到指定 URL，或前进/后退 |
| `computer` | 鼠标点击、移动、拖拽、键盘输入、截图等（13 种 action） |
| `browser_batch` | 一次顺序执行多步工具（densable 对齐；不可嵌套） |
| `form_input` | 填写表单字段 |
| `upload_image` | 上传图片到文件输入框或拖拽区域 |
| `file_upload` | 只传 `paths`（不要传 base64 `files`）。Host densable Uiy：attachments、`/add-dir`、cwd 或 bypass；硬链拒绝；单次 ≤10MB。策略在 Host intercept，不在裸 MCP 子进程 |
| `javascript_tool` | 在页面上下文执行 JavaScript |

### 页面读取

| 操作 | 说明 |
|------|------|
| `read_page` | 获取页面可访问性树（DOM 结构） |
| `get_page_text` | 提取页面纯文本内容 |
| `find` | 用自然语言搜索页面元素 |

### 标签页管理

| 操作 | 说明 |
|------|------|
| `tabs_context_mcp` | 获取当前标签组信息 |
| `tabs_create_mcp` | 创建新标签页 |
| `tabs_close_mcp` | 关闭本会话组内标签页 |

### 监控与调试

| 操作 | 说明 |
|------|------|
| `read_console_messages` | 读取浏览器控制台日志 |
| `read_network_requests` | 读取网络请求记录 |

### 其他

| 操作 | 说明 |
|------|------|
| `resize_window` | 调整浏览器窗口尺寸 |
| `gif_creator` | 录制 GIF 并导出 |
| `shortcuts_list` | 列出可用快捷方式 |
| `shortcuts_execute` | 执行快捷方式 |
| `update_plan` | 向你提交操作计划供审批 |
| `switch_browser` | 广播配对，从 Chrome 内点选浏览器（仅 Bridge） |
| `list_connected_browsers` | 列出当前已连接浏览器（仅 Bridge） |
| `select_browser` | 按 deviceId 选择浏览器（仅 Bridge） |

## 6. 通信模式

Claude in Chrome 支持两种与浏览器通信的方式：

### 本地 Socket（默认）

Chrome 扩展通过 Native Messaging Host 与 CLI 建立 Unix socket 连接。适用于本地开发，无需额外配置。

### Bridge WebSocket

通过 Anthropic 的 bridge 服务中转，支持远程多浏览器。需要 **claude.ai OAuth access token**。  
本 fork 分轨：

| 路径 | 行为 |
|------|------|
| **Connect local** / `CLAUDE_CHROME_FORCE_NATIVE=1` | **只**本地 socket，**不要** claude.ai token |
| 官方 Reconnect / copper flag + OAuth token | densable Bridge（**不动**官方链接与握手页） |
| flag 开但无 token | 自动回退本地 socket（避免误走 bridge 假断开） |

## 7. 常见问题

### 扩展显示未安装

1. **商店安装**：从 Chrome Web Store 安装 "Claude in Chrome"（`claude.ai/chrome`），安装后重启浏览器。
2. **本地 Load unpacked**：CLI 会扫各 profile 的 `Extensions/<id>/` **以及** `Preferences` / `Secure Preferences` 里同 id 的绝对路径。
   - **官方 / 兼容包**：带官方 `manifest.key` → id `fcoeoabgfenejglbffodgkkbkcdhcgfn`。
   - **go-hare / agent-extension fork**（自有 `manifest.key`）：id `bbkeopmjdjdiiaahndbbjhckdbgblpjn` — **CLI 默认已放行**（检测 + native host `allowed_origins`），无需 export 环境变量。`/chrome` → **Connect local** 会重写 host manifest（**不要**只手改 JSON）。
   - 其它自定义 id：`export CLAUDE_CHROME_EXTENSION_IDS=<id1>,<id2>` 追加白名单。
   - 无 `key` 的路径随机 id：**无法**被检测 / native host 接受。路径目录须仍存在。
3. **多 profile**：扩展装在 `Profile 1` 而检测以前只看 packed 目录时会误报；当前版本已覆盖 Secure Preferences。在 `/chrome` 选 **Reconnect extension** 刷新状态。
4. **连接 vs 检测**：`Extension: Installed` 只表示磁盘/偏好里有扩展；`Status: Enabled` 还需要 **This session: On**（或 `--chrome` / default）且 MCP + native messaging 通。

### 工具未出现在工具列表

检查启动时是否加了 `--chrome` 参数，或通过 `/chrome` 命令确认状态。

### 连接超时 / 工具报「扩展未连接」

`/chrome` 显示 **Status: Enabled** 只表示 **CLI 侧 MCP 进程**起来了；真正控浏览器还要 **扩展 → Native Host → Unix socket**。

1. **Connect local**（或重新 setup）会重写 `~/.claude/chrome/chrome-native-host`。dev 下路径应为 `dist/cli.js` 或 `src/entrypoints/cli.tsx`，**不能**是不存在的仓库根 `cli.js`。
2. 改完 wrapper 后：重启 Chrome（或重载扩展），再 `/chrome` → **Connect local**。
3. 确认扩展是带官方 `manifest.key` 的 unpacked（id=`fcoeoabgfenejglbffodgkkbkcdhcgfn`），且用的是装了扩展的 profile。
4. **`tengu_copper_bridge: true` 缓存**（`~/.claude.json` → `cachedGrowthBookFeatures`）会让 densable 走 **Bridge WebSocket**。无 claude.ai OAuth 时本 fork **自动回退本地 socket**；仍异常可设 `CLAUDE_CHROME_FORCE_NATIVE=1`。错误文案若仍写 “same account as Claude Code”，多半是旧进程/旧产物还在用 bridge 断开文案——**整进程退出再 `bun run dev -- --chrome`**。

### 不使用 Chrome 功能时

不带 `--chrome` 参数正常启动即可，不会加载任何浏览器相关模块，不影响其他功能。
