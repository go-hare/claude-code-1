// Reuse 247 peel helpers (asciiSlice / sha / allHits / extractFnAt / lastFnStart)
// from docs/upstream-extraction/v2.1.247/snippets/_peel-1-ye-Ht-Jt-DE.mjs
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const exe =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const b248 = readFileSync(exe)

function asciiSlice(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function allHits(buf, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (i < buf.length) {
    const k = buf.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

function extractFnAt(buf, i, maxLen = 8000) {
  if (i < 0) return { miss: true }
  const win = asciiSlice(buf, i, i + maxLen)
  const paren = win.indexOf('(')
  if (paren < 0) return { i, missEnd: true }
  let depth = 0
  let inStr = null
  let esc = false
  let closeParen = -1
  for (let p = paren; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) {
        closeParen = p
        break
      }
    }
  }
  if (closeParen < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  const bodyStart = win.indexOf('{', closeParen)
  if (bodyStart < 0) return { i, missEnd: true, preview: win.slice(0, 220) }
  depth = 0
  inStr = null
  esc = false
  for (let p = bodyStart; p < win.length; p++) {
    const c = win[p]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const body = win.slice(0, p + 1)
        return { i, body, sha: sha(body), len: body.length }
      }
    }
  }
  return { i, missEnd: true, preview: win.slice(0, 280) }
}

function lastFnStart(before, names) {
  let best = -1
  let name = ''
  for (const n of names) {
    const needle = Buffer.from(n)
    let i = 0
    while (i < before) {
      const k = b248.indexOf(needle, i)
      if (k < 0 || k >= before) break
      if (k > best) {
        best = k
        name = n
      }
      i = k + needle.length
    }
  }
  return { i: best, name }
}

const lines = [
  '# gold-248-agents-needles',
  `exe=${exe}`,
  `bytes=${b248.length}`,
  `when=${new Date().toISOString()}`,
  'helpers=247 _peel-1-ye-Ht-Jt-DE.mjs asciiSlice/allHits/extractFnAt/lastFnStart',
  'scope=#12 #14 #15 #16 #17 #18 #19 #20 #21 #27 #28 #29 #34 #35 #36 #45',
  '',
]

function dumpHits(label, needle, around = 90, cap = 8) {
  const hits = allHits(b248, needle)
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`)
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b248, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

const needles = [
  // #12 Windows agents list keyboard / win32-input-mode
  ['#12 win32-input-mode', 'win32-input-mode'],
  ['#12 win32 input mode', 'win32 input mode'],
  ['#12 win32InputMode', 'win32InputMode'],
  ['#12 WIN32_INPUT', 'WIN32_INPUT'],
  ['#12 ENABLE_VIRTUAL_TERMINAL_INPUT', 'ENABLE_VIRTUAL_TERMINAL_INPUT'],
  ['#12 ENABLE_QUICK_EDIT_MODE', 'ENABLE_QUICK_EDIT_MODE'],
  ['#12 ENABLE_EXTENDED_FLAGS', 'ENABLE_EXTENDED_FLAGS'],
  ['#12 virtual terminal input', 'virtual terminal input'],
  ['#12 kitty keyboard', 'kitty keyboard'],
  ['#12 DISABLE_KITTY_KEYBOARD', 'DISABLE_KITTY_KEYBOARD'],
  ['#12 modifyOtherKeys', 'modifyOtherKeys'],
  ['#12 ?9001', '?9001'],
  ['#12 after detaching', 'after detaching'],
  ['#12 after detach', 'after detach'],
  ['#12 CLAUDE_AGENTS_SELECT', 'CLAUDE_AGENTS_SELECT'],
  ['#12 setRawMode', 'setRawMode'],

  // #14 model names as code / [1m] not a link
  ['#14 append [1m] to the model name', 'append [1m] to the model name'],
  ['#14 neutralizedByFork', 'neutralizedByFork'],
  ['#14 sonnet[1m]', 'sonnet[1m]'],
  ['#14 render as code', 'render as code'],
  ['#14 as code so', 'as code so'],
  ['#14 markdown link', 'markdown link'],
  ['#14 fast-mode', 'fast-mode'],
  ['#14 Fast mode', 'Fast mode'],
  ['#14 switched to', 'switched to'],
  ['#14 model name cannot be empty', 'Model name cannot be empty'],

  // #15 agents CI trust
  ['#15 ensureAgentsWorkspaceTrust', 'ensureAgentsWorkspaceTrust'],
  ['#15 agentsTrustDecision', 'agentsTrustDecision'],
  ['#15 Workspace trust not yet accepted', 'Workspace trust not yet accepted'],
  ['#15 skipping workspace trust', 'skipping workspace trust'],
  ['#15 skip workspace trust', 'skip workspace trust'],
  ['#15 process.env.CI', 'process.env.CI'],
  ['#15 CLAUBBIT', 'CLAUBBIT'],
  ['#15 IS_DEMO', 'IS_DEMO'],
  ['#15 agents skipping', 'agents skipping'],

  // #16 PR-status cache malformed
  ['#16 PR-status', 'PR-status'],
  ['#16 pr-status', 'pr-status'],
  ['#16 prStatusByUrl', 'prStatusByUrl'],
  ['#16 lastPersistedCacheBody', 'lastPersistedCacheBody'],
  ['#16 prStatuses', 'prStatuses'],
  ['#16 prStatusFooterEnabled', 'prStatusFooterEnabled'],
  ['#16 gh-pr-status-cache', 'gh-pr-status-cache'],
  ['#16 baseRepoCache', 'baseRepoCache'],
  ['#16 Cannot destructure property prStatuses', "Cannot destructure property 'prStatuses'"],
  ['#16 malformed', 'malformed'],
  ['#16 JSON.parse pr', 'prStatus'],

  // #17 stale bg resurrect / ask before resume
  ['#17 weeks-old', 'weeks-old'],
  ['#17 weeks old', 'weeks old'],
  ['#17 machine was off', 'machine was off'],
  ['#17 ask before resuming', 'ask before resuming'],
  ['#17 ask before resume', 'ask before resume'],
  ['#17 Resume this session', 'Resume this session'],
  ['#17 Resume the saved', 'Resume the saved'],
  ['#17 lastHeartbeat', 'lastHeartbeat'],
  ['#17 hostDied', 'hostDied'],
  ['#17 stale session', 'stale session'],
  ['#17 real end', 'real end'],
  ['#17 stopped at', 'stopped at'],
  ['#17 resume overlay', 'resume overlay'],
  ['#17 Resume saved', 'Resume saved'],

  // #18 older conversation / drop typed prompt
  ['#18 older conversation', 'older conversation'],
  ['#18 typed prompt', 'typed prompt'],
  ['#18 queuedPrompt', 'queuedPrompt'],
  ['#18 initialPrompt', 'initialPrompt'],
  ['#18 starting a new session', 'starting a new session'],
  ['#18 newsession', 'newsession'],
  ['#18 restoreSessionId', 'restoreSessionId'],
  ['#18 dropped prompt', 'dropped prompt'],

  // #19 already open in a terminal
  ['#19 open in a terminal', 'open in a terminal'],
  ['#19 open in another terminal', 'open in another terminal'],
  ['#19 already resumed', 'already resumed'],
  ['#19 already open', 'already open'],
  ['#19 terminalHolders', 'terminalHolders'],
  ['#19 open elsewhere', 'open elsewhere'],
  ['#19 attached elsewhere', 'attached elsewhere'],
  ['#19 open in another', 'open in another'],
  ['#19 in a terminal', 'in a terminal'],
  ['#19 already running', 'already running'],

  // #20 merged but unpushed
  ['#20 not pushed anywhere', 'not pushed anywhere'],
  ['#20 not pushed anywhere!', 'not pushed anywhere!'],
  ['#20 merged into', 'merged into'],
  ['#20 already merged', 'already merged'],
  ['#20 default branch', 'default branch'],
  ['#20 --not --remotes', '--not --remotes'],
  ['#20 rev-list --all --not --remotes', 'rev-list"],"--all","--not","--remotes'],
  ['#20 merge-base --is-ancestor', 'merge-base"],"--is-ancestor'],

  // #21 hook invalid answer / schema
  ['#21 schema error', 'schema error'],
  ['#21 invalid answer', 'invalid answer'],
  ['#21 hook schema', 'hook schema'],
  ['#21 PermissionRequest hook', 'PermissionRequest hook'],
  ['#21 PreToolUse hook', 'PreToolUse hook'],
  ['#21 hook returned blocking error', 'hook returned blocking error'],
  ['#21 hook error', ' hook error'],
  ['#21 invalid PermissionRequest', 'invalid PermissionRequest'],
  ['#21 invalid PreToolUse', 'invalid PreToolUse'],
  ['#21 hook answer', 'hook answer'],

  // #27 claude logs terminal modes
  ['#27 mouse tracking', 'mouse tracking'],
  ['#27 bracketed paste', 'bracketed paste'],
  ['#27 alternate screen', 'alternate screen'],
  ['#27 cleanupTerminalModes', 'cleanupTerminalModes'],
  ['#27 DISABLE_MOUSE_TRACKING', 'DISABLE_MOUSE_TRACKING'],
  ['#27 ?1000l', '?1000l'],
  ['#27 ?2004l', '?2004l'],
  ['#27 ?1049l', '?1049l'],
  ['#27 claude logs', 'claude logs'],
  ['#27 leaving mouse', 'leaving mouse'],

  // #28 trust dialog mid-emoji
  ['#28 mid-emoji', 'mid-emoji'],
  ['#28 mid emoji', 'mid emoji'],
  ['#28 toWellFormed', 'toWellFormed'],
  ['#28 isWellFormed', 'isWellFormed'],
  ['#28 Intl.Segmenter', 'Intl.Segmenter'],
  ['#28 grapheme', 'grapheme'],
  ['#28 \\uFFFD', '\\uFFFD'],
  ['#28 replacement character', 'replacement character'],

  // #29 perm mode vs Ctrl-C again
  ['#29 Press Ctrl-C again to exit', 'Press Ctrl-C again to exit'],
  ['#29 press ctrl+c or q again to exit', 'press ctrl+c or q again to exit'],
  ['#29 will keep running', 'will keep running'],
  ['#29 shift+tab', 'shift+tab'],
  ['#29 Shift+Tab', 'Shift+Tab'],

  // #34 startup warnings one column
  ['#34 MCP servers need authentication', 'MCP servers need authentication'],
  ['#34 servers need authentication', 'servers need authentication'],
  ['#34 need authentication', 'need authentication'],
  ['#34 one column', 'one column'],
  ['#34 one column right', 'one column right'],
  ['#34 startup warning', 'startup warning'],

  // #35 worktree lock hold
  ['#35 git worktree lock', 'git worktree lock'],
  ['#35 worktree lock', 'worktree lock'],
  ['#35 lock --reason', 'lock --reason'],
  ['#35 git worktree remove', 'git worktree remove'],
  ['#35 holds the worktree', 'holds the worktree'],
  ['#35 hold the worktree', 'hold the worktree'],

  // #36 IME @-mentions
  ['#36 non-Latin', 'non-Latin'],
  ['#36 non-latin', 'non-latin'],
  ['#36 IME', 'IME'],
  ['#36 Korean', 'Korean'],
  ['#36 NFKC', 'NFKC'],
  ['#36 NFD', '.normalize("NFD")'],
  ['#36 NFC', '.normalize("NFC")'],
  ['#36 mention match', 'mention match'],
  ['#36 @ mention', '@ mention'],

  // #45 shift+enter / ctrl+enter dispatch+attach
  ['#45 shift+enter', 'shift+enter'],
  ['#45 ctrl+enter', 'ctrl+enter'],
  ['#45 Ctrl+Enter', 'Ctrl+Enter'],
  ['#45 dispatch and attach', 'dispatch and attach'],
  ['#45 dispatches and attaches', 'dispatches and attaches'],
  ['#45 ctrl+j', 'ctrl+j'],
]

for (const [label, needle] of needles) dumpHits(label, needle)

writeFileSync(`${outDir}/gold-248-agents-needles.txt`, lines.join('\n'))
console.log(
  'WROTE',
  `${outDir}/gold-248-agents-needles.txt`,
  'lines',
  lines.length,
)
