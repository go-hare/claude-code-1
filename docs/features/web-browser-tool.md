# WEB_BROWSER_TOOL — 浏览器工具

> Feature Flag: `FEATURE_WEB_BROWSER_TOOL=1`
> 实现状态：核心工具已实现（browser-lite 结果通过 tool_result 内联返回，无侧边面板）
> 引用数：4

## 一、功能概述

WEB_BROWSER_TOOL 让模型可以启动浏览器实例、导航网页、与页面元素交互。使用 Bun 的内置 WebView API 提供无头/有头浏览器能力。

## 二、实现架构

### 2.1 模块状态

| 模块 | 文件 | 状态 |
|------|------|------|
| 浏览器工具 | `packages/builtin-tools/src/tools/WebBrowserTool/WebBrowserTool.ts` | **已实现** |
| 工具注册 | `src/tools.ts` | **布线** — 动态加载 |
| WebView 检测 | `src/main.tsx` | **布线** — `'WebView' in Bun` 检测 |

### 2.2 预期数据流

```
模型调用 WebBrowserTool
         │
         ▼
Bun WebView 创建浏览器实例
         │
         ├── navigate(url) — 导航到 URL
         ├── click(selector) — 点击元素
         ├── screenshot() — 截取页面截图
         └── extract(selector) — 提取页面内容
         │
         ▼
结果通过 tool_result 内联返回给模型
```

## 三、需要补全的内容

| 模块 | 工作量 | 说明 |
|------|--------|------|
| `WebBrowserTool.ts` | ✅ 已实现 | 工具 schema + Bun WebView API 执行 |

## 四、关键设计决策

1. **Bun WebView API**：使用 Bun 内置的 WebView 而非外部浏览器驱动（Puppeteer/Playwright）
2. **内联结果返回**：browser-lite 直接通过 `tool_result` 返回结果，不依赖独立的 REPL 侧边面板
3. **Bun 特性检测**：`'WebView' in Bun` 检查运行时是否支持

## 五、使用方式

```bash
FEATURE_WEB_BROWSER_TOOL=1 bun run dev
```

## 六、文件索引

| 文件 | 职责 |
|------|------|
| `packages/builtin-tools/src/tools/WebBrowserTool/WebBrowserTool.ts` | 工具实现（已实现） |
| `src/tools.ts:115-116` | 工具注册 |
