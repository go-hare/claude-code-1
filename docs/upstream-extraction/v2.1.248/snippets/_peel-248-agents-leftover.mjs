// Local leftover vs missing for 248 agents peel.
// Helpers reused from 247 _peel-1-ye-Ht-Jt-DE.mjs (allHits only).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const root = 'D:/work/py/claude/claude-code'
const lines = [
  '# gold-248-agents-leftover',
  `when=${new Date().toISOString()}`,
  'scope=src/ + packages/ only; tests listed when they are the only hit',
  'rule=leftover = same unique string exists locally; missing = no file:line',
  '',
]

const needles = [
  ['#12', 'applyFleetViewHostWindowsEnv'],
  ['#12', 'WIN32_INPUT_MODE'],
  ['#12', 'handoffRawMode'],
  ['#12', 'CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT'],
  ['#14', 'showFastModeNotice'],
  ['#14', 'fast-mode-toggled'],
  ['#14', 'model-switch-fast-mode'],
  ['#14', 'Fast mode ON'],
  ['#15', 'ensureAgentsWorkspaceTrust'],
  ['#15', 'agentsTrustDecision'],
  ['#15', 'process.env.CI'],
  ['#16', 'loadPrStatusCache'],
  ['#16', 'persistPrStatusCache'],
  ['#16', 'malformed cache entries'],
  ['#16', 'gh-pr-status-cache'],
  ['#17', 'dead_epoch_transcript_gone'],
  ['#17', 'ended while the background service was off'],
  ['#17', 'saved conversation is no longer on disk'],
  ['#17', 'deadEpochReapedAt'],
  ['#18', 'openNewSessionRow'],
  ['#18', 'willInsertNewline'],
  ['#19', 'Open in a terminal'],
  ['#19', 'continue it there'],
  ['#19', 'terminalHolderOf'],
  ['#19', 'resume_session_live_elsewhere'],
  ['#19', 'already open in another running Claude session'],
  ['#20', 'has commits that are not pushed anywhere'],
  ['#20', 'rev-list"],"--all","--not","--remotes'],
  ['#21', 'async hook JSON output failed schema validation'],
  ['#21', 'PermissionRequest hook'],
  ['#27', 'cli_bg_logs'],
  ['#27', 'claude logs <id>'],
  ['#27', 'cleanupTerminalModes'],
  ['#28', 'toWellFormed'],
  ['#28', 'cut off mid-emoji'],
  ['#29', 'Press Ctrl-C again to exit'],
  ['#29', 'exitArmed'],
  ['#34', 'mcp-needs-auth'],
  ['#34', 'mcpNeedsAuthCount'],
  ['#34', 'servers need authentication'],
  ['#35', 'no worktree lock names this process'],
  ['#35', 'worktree lock --reason'],
  ['#35', 'git worktree lock'],
  ['#36', 'toLocaleLowerCase'],
  ['#45', 'canDispatchAndOpen'],
  ['#45', 'ctrl+enter to start and open'],
  ['#45', 'ctrl+j for newline'],
]

const skipDir = new Set([
  'node_modules',
  'dist',
  '.git',
  'docs',
  'coverage',
])

function walk(dir, acc) {
  let ents
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue
    if (skipDir.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) acc.push(p)
  }
}

const files = []
walk(join(root, 'src'), files)
walk(join(root, 'packages'), files)

const cache = new Map()
function text(p) {
  let t = cache.get(p)
  if (t === undefined) {
    t = readFileSync(p, 'utf8')
    cache.set(p, t)
  }
  return t
}

function hitsInFile(p, needle) {
  const t = text(p)
  const out = []
  let i = 0
  let line = 1
  let lineStart = 0
  while (i < t.length) {
    const k = t.indexOf(needle, i)
    if (k < 0) break
    while (lineStart < k) {
      const nl = t.indexOf('\n', lineStart)
      if (nl < 0 || nl >= k) break
      line++
      lineStart = nl + 1
    }
    const end = t.indexOf('\n', k)
    out.push({
      file: relative(root, p).replaceAll('\\', '/'),
      line,
      snippet: t.slice(k, Math.min(k + 80, end < 0 ? t.length : end)).replace(/\s+/g, ' '),
    })
    i = k + needle.length
  }
  return out
}

for (const [tag, needle] of needles) {
  const hits = []
  for (const p of files) {
    const hs = hitsInFile(p, needle)
    for (const h of hs) hits.push(h)
  }
  lines.push(`## ${tag}  needle=${JSON.stringify(needle)}  localHits=${hits.length}`)
  if (hits.length === 0) lines.push('- MISSING')
  else {
    for (const h of hits.slice(0, 8)) {
      lines.push(`- ${h.file}:${h.line} ${h.snippet}`)
    }
    if (hits.length > 8) lines.push(`- … +${hits.length - 8} more`)
  }
  lines.push('')
}

writeFileSync(`${outDir}/gold-248-agents-leftover.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-agents-leftover.txt`, 'lines', lines.length)
