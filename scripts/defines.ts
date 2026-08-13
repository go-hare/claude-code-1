import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(__dirname, '..', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

/**
 * Official densable embeds MACRO.GIT_SHA at build time (emO --version --verbose
 * prints `Commit: <sha>`). Prefer env (CI) then `git rev-parse HEAD`.
 */
function resolveGitSha(): string {
  const fromEnv =
    process.env.GIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA
  if (fromEnv && /^[0-9a-f]{7,40}$/i.test(fromEnv.trim())) {
    return fromEnv.trim().toLowerCase()
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      cwd: resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim()
  } catch {
    return ''
  }
}

/**
 * Shared MACRO define map used by both dev.ts (runtime -d flags)
 * and build.ts (Bun.build define option).
 *
 * Each value is a JSON-stringified expression that replaces the
 * corresponding MACRO.* identifier at transpile / bundle time.
 *
 * VERSION is read from package.json to avoid version drift.
 */
export function getMacroDefines(): Record<string, string> {
  return {
    'MACRO.VERSION': JSON.stringify(pkg.version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    // Official densable: GIT_SHA used by `claude --version --verbose`.
    'MACRO.GIT_SHA': JSON.stringify(resolveGitSha()),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify(
      'https://github.com/go-hare/claude-code-1/issues',
    ),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify(
      'report the issue at https://github.com/go-hare/claude-code-1/issues',
    ),
    'MACRO.NATIVE_PACKAGE_URL': JSON.stringify('@go-hare/claude-code'),
    'MACRO.PACKAGE_URL': JSON.stringify('@go-hare/claude-code'),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(
      'https://github.com/go-hare/claude-code-1/blob/main/CHANGELOG.md',
    ),
  }
}

/**
 * Default feature flags enabled in both Bun.build and Vite builds.
 * Additional features can be enabled via FEATURE_<NAME>=1 env vars.
 *
 * Used by:
 *   - build.ts (Bun.build)
 *   - scripts/vite-plugin-feature-flags.ts (Vite/Rollup)
 *   - scripts/dev.ts (bun run dev)
 */
export const DEFAULT_BUILD_FEATURES = [
  'BUDDY', // 陪伴宠物角色（Squirtle Waddles）
  'TRANSCRIPT_CLASSIFIER', // 对话分类器，用于标注会话类型
  'BRIDGE_MODE', // Remote Control / Bridge 模式，远程控制会话
  'AGENT_TRIGGERS_REMOTE', // sessionIngress 模块级 Map 累积（非 GB 级主因）
  'CHICAGO_MCP', // Chicago MCP 集成（内部代号）
  'VOICE_MODE', // Push-to-Talk 语音输入模式
  'SHOT_STATS', // 单次请求统计信息收集
  'PROMPT_CACHE_BREAK_DETECTION', // 检测 prompt cache 是否被打破（有 10 条上限，可控）
  'TOKEN_BUDGET', // Token 预算管理与控制
  // P0: local features
  'AGENT_TRIGGERS', // 本地 Agent 触发器（工具调用时启动子代理）
  'ULTRATHINK', // 超深度思考模式，增加推理链长度
  'BUILTIN_EXPLORE_PLAN_AGENTS', // 内置 Explore/Plan 子代理类型
  'LODESTONE', // 上下文锚点，优化长对话的相关性检索
  'EXTRACT_MEMORIES', // 每次 turn 结束 fork 完整消息历史（非 GB 级主因）
  'VERIFICATION_AGENT', // 任务完成后 fork 完整消息（非 GB 级主因）
  'KAIROS_BRIEF', // Kairos 定时摘要（定时汇报当前状态）
  'AWAY_SUMMARY', // 离线摘要（用户离开后生成总结）
  // densable 2.1.222 #21 Removed ultraplan feature — product default OFF.
  // Residual modules (commands/ultraplan, components/ultraplan, ccrSession,
  // ULTRAPLAN_TAG / isUltraplan / teleport) stay feature-gated for history &
  // FEATURE_ULTRAPLAN=1 revive; do NOT re-enable in DEFAULT_BUILD_FEATURES.
  // 'ULTRAPLAN',
  'DAEMON', // 守护进程模式，长驻 supervisor 管理后台 worker（非 GB 级主因）
  'ACP', // ACP 代理协议，支持外部 agent 接入
  'WORKFLOW_SCRIPTS', // 工作流脚本（.claude/workflows/ 中的 YAML/MD）
  // densable SEA ships reactive compact (QGo / tengu_reactive_compact_* /
  // Ysa "automatic compaction failed"). Without this flag, feature() DCE
  // nulls query.ts reactiveCompact → 413/PTL is not withheld and long-session
  // resume dies as "Prompt is too long" + exit 1. Source + #25 tests already
  // present; product pack must match densable. Do NOT enable CONTEXT_COLLAPSE
  // or HISTORY_SNIP here — collapse remains stub-risk / suppress-autocompact.
  'REACTIVE_COMPACT', // 413/PTL withhold + tryReactiveCompact recovery (+ Ysa annotate)
  // 'HISTORY_SNIP', // 已禁用：snip 功能暂时关闭
  // 'CONTEXT_COLLAPSE', // 已禁用：实现是空壳 stub，启用后会抑制 auto compact 导致上下文管理完全失效
  'MONITOR_TOOL', // Monitor 工具，流式监控后台进程输出
  // 'FORK_SUBAGENT',            // 已禁用：通过 Agent tool 的特殊方式实现了等效功能，无需再开
  'KAIROS', // Kairos 定时任务系统核心
  // KAIROS 外围（densable SEA 有 SendUserFile/PushNotification/channel 产品串；
  // 本地实现已 feature 门控。2026-08-12 默认 ON 对齐 densable 产品面）。
  // SendUserFile 已挂 KAIROS；PushNotification = KAIROS || KAIROS_PUSH；
  // Channels / SubscribePR 需下列子 flag。
  'KAIROS_CHANNELS', // MCP channels 通知 / Logo notice / permission channel 回调
  'KAIROS_PUSH_NOTIFICATION', // PushNotification 独立臂（与 KAIROS OR）
  'KAIROS_GITHUB_WEBHOOKS', // SubscribePR + bridge webhook sanitizer
  'COORDINATOR_MODE', // 多 worker 编排模式（AgentSummary 泄露已在 52b61c2c 修复）
  // densable 2.1.228 ships full UDS inbox product (key_publish_failed /
  // CLAUDE_CODE_MESSAGING_TOKEN / cross-session from-name). Default ON for
  // 1:1 alignment. Historical "build 后 node hang" comment was a go-hare
  // engineering deferral — not densable product OFF. Re-verify with
  // `bun run build` + `node dist/cli.js --version` if regressions reappear.
  'UDS_INBOX', // 本机 UDS inbox / peers / pipes control plane
  'LAN_PIPES', // 局域网 TCP + UDP beacon；依赖 UDS_INBOX 编译面
  'BG_SESSIONS', // 后台会话管理（ps/logs/attach/kill）
  'TEMPLATES', // 模板任务（new/list/reply 子命令）
  // 'REVIEW_ARTIFACT',          // 代码审查产物（API 请求无响应，待排查 schema 兼容性）
  // API content block types
  'CONNECTOR_TEXT', // Connector 文本块类型，扩展 API 内容格式
  // Attribution tracking
  'COMMIT_ATTRIBUTION', // Git 提交归属追踪（记录 AI 辅助贡献）
  // Server mode (claude server / claude open)
  'DIRECT_CONNECT', // 直连模式（claude server / claude open）
  // Skill search & learning — feature flags compiled in (so the slash
  // commands /skill-* etc. exist), but the runtime "enabled" toggle
  // defaults to OFF (see featureCheck.ts). Operators turn on via the
  // slash-command toggle or env vars (SKILL_SEARCH_ENABLED=1,
  // SKILL_LEARNING_ENABLED=1). Rationale: bounded caches added on
  // this branch (see docs/agent/sur-skill-overflow-bugs.md) close the
  // overflow risk, but Haiku-on-first-Chinese-query and disk-side
  // observation accumulation remain operator-discretion concerns.
  'EXPERIMENTAL_SKILL_SEARCH', // 技能搜索（bounded caches 已修复 overflow，内存问题已解决）
  'EXPERIMENTAL_SEARCH_EXTRA_TOOLS', // 工具搜索预取管道（TF-IDF 索引 + inter-turn 异步预取）
  // 'SKILL_LEARNING',
  // P3: poor mode
  'POOR', // 穷鬼模式，跳过 extract_memories/prompt_suggestion 减少消耗
  // Team Memory — densable SEA 有完整 team memory 产品串；本地 teamMemorySync
  // 已实现（OAuth + GitHub remote 运行时门）。旧注释「邮箱无限增长」过时：
  // teammateMailbox 已有 MAX_* + compact（与 TEAMMEM 同步面独立）。
  'TEAMMEM', // memory/team 双向同步 + extractMemories team 路径
  // SSH Remote
  'SSH_REMOTE', // SSH 远程连接，本地 REPL + 远端工具执行
  // Autofix PR
  'AUTOFIX_PR', // /autofix-pr 命令（fork 引入；docs/jira/AUTOFIX-PR-001.md 承诺默认开启）
  // Native clipboard
  'NATIVE_CLIPBOARD_IMAGE', // macOS FFI 直读 NSPasteboard，替代 osascript（~5ms vs ~600ms）
  // Persistent thread goal command — auto-continuation, JSONL persistence,
  // strict completion/blocked audit. See src/services/goal.
  'GOAL',
] as const
