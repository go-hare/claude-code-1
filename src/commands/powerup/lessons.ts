import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

export type PowerupLesson = {
  id: string
  title: string
  tagline: string
  summary: string
  frames: readonly string[]
  details: string
  tip: string
}

/**
 * Official 2.1.331 `ZW` — all 10 `/powerup` lessons in exact order.
 */
export const POWERUP_LESSONS: readonly PowerupLesson[] = [
  {
    id: 'at-mentions',
    title: 'Talk to your codebase',
    tagline: '@ files, line refs',
    summary:
      'Type @ anywhere in your prompt to find and attach a file. Claude reads it before answering.',
    frames: [
      '> what does @\ntype a file name…',
      '> what does @src/auth.ts\n  ❯ src/auth.ts\n    src/auth.test.ts',
      '> what does @src/auth.ts do?\n◐ Reading src/auth.ts…',
      '> what does @src/auth.ts do?\nExports validateToken() which\nchecks JWT expiry and signature.',
    ],
    details:
      'Reference specific lines with src/app.ts:42 and Claude jumps straight there. Works in both directions: Claude cites files the same way, so you can open them in your editor.',
    tip: 'Also try: @src/ to attach a whole directory.',
  },
  {
    id: 'modes',
    title: 'Steer with modes',
    tagline: 'shift+tab, plan, auto',
    summary:
      'Press shift+tab to cycle permission modes. Each mode changes how much Claude asks before acting:',
    frames: [
      'default — ask before every edit',
      'accept edits — edit freely, ask for commands',
      'plan — research and propose, never touch files',
      'auto — Claude decides what is safe',
    ],
    details:
      'default: ask before every edit · accept edits: edit freely, ask for commands · plan: research and propose, never touch files · auto: Claude decides what is safe.',
    tip: 'Use plan for big refactors you want to review first. Use auto for long unattended tasks. Run /permissions to pre-allow specific commands so Claude stops asking about them.',
  },
  {
    id: 'undo',
    title: 'Undo anything',
    tagline: '/rewind, Esc-Esc',
    summary:
      'Claude checkpoints your files before every edit. Press Esc Esc to open /rewind and go back to any earlier point: code, conversation, or both.',
    frames: [
      '✓ Updated regex in parser.ts\n8 tests failing',
      'press Esc Esc\nRewind to:\n  ❯ before parser.ts edit',
      '✓ parser.ts restored\n> try a simpler approach\n◐ thinking…',
    ],
    details:
      'Went down the wrong path? Rewind to before the detour and try a different prompt. Your git history stays clean.',
    tip: 'Also: /clear starts fresh and keeps your files. /branch forks the conversation to try two approaches.',
  },
  {
    id: 'background',
    title: 'Run in the background',
    tagline: 'tasks, /tasks',
    summary:
      'Long builds and test suites do not have to block you. Add & to any bash command and it runs in the background — you keep chatting, Claude notifies you when it finishes.',
    frames: [
      '> run the test suite &\ntask started in background',
      '> now fix the lint in app.ts\n◐ Editing app.ts…\n◐ bun test · 12s',
      '> now fix the lint in app.ts\n✓ Removed unused import\n◐ bun test · 28s',
      '> now fix the lint in app.ts\n✓ Removed unused import\n✓ bun test · 284 pass',
    ],
    details:
      "Run /tasks to see what's running. Claude can read the output and react to failures.",
    tip: 'Subagents show up there too.',
  },
  {
    id: 'memory',
    title: 'Teach Claude your rules',
    tagline: 'CLAUDE.md, /memory',
    summary:
      'Drop a CLAUDE.md file in your repo and Claude reads it at the start of every session. Put your conventions there: test commands, style rules, do-not-touch directories.',
    frames: [
      '─ CLAUDE.md ─\nRun tests with: bun test\nNever edit src/legacy/',
      '> add tests for the cache\n◐ reading CLAUDE.md…',
      '> add tests for the cache\nWriting cache.test.ts,\nrunning bun test to verify.',
    ],
    details:
      'Run /init to generate a starter CLAUDE.md from your codebase. Run /memory to edit it inline.',
    tip: 'Works at three levels: repo, your home directory (all projects), and per-directory overrides.',
  },
  {
    id: 'mcp',
    title: 'Extend with tools',
    tagline: 'MCP, /mcp',
    summary:
      'MCP servers give Claude new tools: read your Slack, query your database, control your browser. Run /mcp to browse and connect servers.',
    frames: [
      '> /mcp\nConnected servers:\n  ✓ slack    ✓ github',
      '> anything urgent in #eng?\n◐ slack · reading channel…',
      'Boris posted about the merge\nfreeze. Also 3 PRs await\nyour review on github.',
    ],
    details:
      'Once connected, ask Claude to "check my calendar" or "search our Notion".',
    tip: 'From your shell, run `claude mcp add my-server -- node ./my-server.js` to add one.',
  },
  {
    id: 'automate',
    title: 'Automate your workflow',
    tagline: 'skills, hooks',
    summary:
      'Save a prompt to .claude/skills/deploy/SKILL.md and it becomes /deploy. Run /skills to see what you have.',
    frames: [
      '> /deploy staging\n◐ skill: deploy',
      '✓ built\n✓ tests pass\n◐ pushing to staging…',
      '✓ deployed\nstaging.app.com\nPostToolUse hook ran prettier',
    ],
    details:
      'Hooks run your scripts on events: before a tool call, after a response, on session start. Use them to enforce rules or add context. Run /hooks to see what runs when.',
    tip: 'Run /install-github-app to let Claude review PRs when tagged.',
  },
  {
    id: 'subagents',
    title: 'Multiply yourself',
    tagline: 'subagents',
    summary:
      'Claude can run subagents to work in parallel. Try "use subagents to search these 5 directories".',
    frames: [
      '> find any error handling bugs\n◐ Running 3 subagents…',
      '◐ agent-1 · scanning api\n◐ agent-2 · scanning utils\n◐ agent-3 · scanning cli',
      '✓ agent-1 · found reject\n◐ agent-2 · scanning utils\n✓ agent-3 · no issues',
      'Found 2 issues:\n  api/fetch.ts:42 unhandled\n  utils/retry.ts:18 swallowed',
    ],
    details:
      'Subagents run in isolated context so deep searches do not crowd your main conversation.',
    tip: 'For true parallel sessions on separate branches, launch with `claude --worktree`.',
  },
  {
    id: 'cross-device',
    title: 'Code from anywhere',
    tagline: '/remote-control, /teleport',
    summary:
      'Run /remote-control to use this session from claude.ai/code or the Code tab in the Claude mobile app. It keeps running on this computer.',
    frames: [
      '> /remote-control\n◐ connecting…',
      '✓ connected\nsee this session at\nclaude.ai/code/abc123',
      '─ on your phone ─\nabc123 · running tests\n◐ 142 of 284',
      '─ on your phone ─\nabc123 · ✓ all pass\n> ship it',
    ],
    details:
      'Run /teleport to move a session between here and the cloud — send this one up to keep it going after you close the lid, or pull a cloud session into this terminal with full history.',
    tip: 'Kick off a long task, close your laptop, check progress from your phone.',
  },
  {
    id: 'model-dial',
    title: 'Dial the model',
    tagline: '/model, /effort',
    summary:
      'Run /model to switch models. Opus for complex work, Sonnet for most tasks, Haiku for quick questions. Each trades speed for depth.',
    frames: [
      '> /effort high\neffort set to high',
      '> why is the list page slow?\n◐ thinking deeply…',
      'Three hypotheses, ranked:\n 1. N+1 query in loader\n 2. missing index on users',
    ],
    details:
      '/effort controls how long Claude thinks before answering. high for tricky bugs, low when you just need a quick edit.',
    tip: 'Also: /fast gives faster output from the same model.',
  },
] as const

const VALID_LESSON_IDS = new Set(POWERUP_LESSONS.map(lesson => lesson.id))

export function isValidPowerupLessonId(id: string): boolean {
  return VALID_LESSON_IDS.has(id)
}

export function getPowerupsStatePath(
  configDir: string = getClaudeConfigHomeDir(),
): string {
  return join(configDir, 'powerups.json')
}

export function loadUnlockedPowerups(
  configDir: string = getClaudeConfigHomeDir(),
): Set<string> {
  try {
    const filePath = getPowerupsStatePath(configDir)
    if (!existsSync(filePath)) return new Set()
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { powerupsUnlocked?: unknown }
    if (!Array.isArray(parsed.powerupsUnlocked)) return new Set()
    return new Set(
      parsed.powerupsUnlocked.filter(
        (v): v is string => typeof v === 'string' && isValidPowerupLessonId(v),
      ),
    )
  } catch {
    return new Set()
  }
}

export function saveUnlockedPowerups(
  unlocked: ReadonlySet<string>,
  configDir: string = getClaudeConfigHomeDir(),
): boolean {
  try {
    const filePath = getPowerupsStatePath(configDir)
    mkdirSync(dirname(filePath), { recursive: true })
    const validIds = [...unlocked].filter(isValidPowerupLessonId)
    writeFileSync(
      filePath,
      `${JSON.stringify({ powerupsUnlocked: validIds }, null, 2)}\n`,
      'utf8',
    )
    return true
  } catch {
    return false
  }
}
