// densable 2.1.248 peel pass3 — remaining bodies
// helpers from v2.1.247/snippets/_peel-1-ye-Ht-Jt-DE.mjs
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
const exe248 =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const exe247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const b248 = readFileSync(exe248)
const b247 = existsSync(exe247) ? readFileSync(exe247) : null

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

const lines = [
  '# gold-248-cache-3  densable 2.1.248 pass3',
  `# bytes248=${b248.length} 247=${b247 ? b247.length : 'ABSENT'}`,
  `# when=${new Date().toISOString()}`,
  '# NEVER HAVE — peel only',
  '',
]

function dumpHits(label, needle, around = 90, cap = 8) {
  const hits = allHits(b248, needle)
  const n247 = b247 ? allHits(b247, needle).length : 'NA'
  lines.push(
    `## ${label}  needle=${JSON.stringify(needle)}  hits248=${hits.length}  hits247=${n247}`,
  )
  for (const [idx, i] of hits.slice(0, cap).entries()) {
    lines.push(
      `- #${idx} @${i} ${asciiSlice(b248, i - around, i + needle.length + around)}`,
    )
  }
  if (hits.length > cap) lines.push(`- … +${hits.length - cap} more`)
  lines.push('')
  return hits
}

function dumpFnExact(label, i, maxLen = 4000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
}

function dumpWin(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

const needles = [
  ['#11 OAuthRefreshLockTimeoutError', 'OAuthRefreshLockTimeoutError'],
  ['#11 OAuthRefreshDeadError', 'OAuthRefreshDeadError'],
  [
    '#11 Could not refresh your login because another',
    'Could not refresh your login because another Claude Code process',
  ],
  [
    '#11 Failed to refresh OAuth token: another',
    'Failed to refresh OAuth token: another Claude Code process',
  ],
  ['#11 holding the refresh lock', 'holding the refresh lock'],
  ['#11 Try again in a minute', 'Try again in a minute'],
  ['#22 not valid JSON —', 'not valid JSON \u2014'],
  ['#22 Hook output looks like a JSON object', 'Hook output looks like a JSON object'],
  ['#37 invalidSetting', 'invalidSetting'],
  ['#37 decidedBy', 'decidedBy'],
  ['#38 function Nde', 'function Nde()'],
  ['#42 SAFE STREAM_WATCHDOG window', 'CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK"],"CLAUDE_ENABLE_STREAM_WATCHDOG"'],
  ['#23 Text bold claude.ai', 'claude.ai</Text>'],
  ['#23 heading.label', 'heading.label'],
  ['#23 getScopeHeading', 'getScopeHeading'],
  ['#23 Manage MCP servers', 'Manage MCP servers'],
  ['#44 socket directory', 'socket directory'],
  ['#44 cannot be used', 'cannot be used'],
  ['#44 /status', '/status'],
  ['#48 overflowuid', 'overflowuid'],
  ['#48 65534', '65534'],
  ['#48 nobody', 'nobody'],
  ['#48 F1t', 'function F1t('],
  ['#25 noConsentSurface', 'noConsentSurface'],
  ['#25 forceLoginGatewayUrl', 'forceLoginGatewayUrl'],
  ['#24 ye headersHelper Authorization', 'headersHelper'],
]

for (const [label, needle] of needles) dumpHits(label, needle)

// known offsets
dumpFnExact('#11 OAuthRefreshLockTimeoutError class', 180967500, 500)
dumpWin('#11 locktimeout-win', 180967500, 80, 400)
dumpWin('#11 failed-refresh-oauth', b248.indexOf(Buffer.from('Failed to refresh OAuth token: another Claude Code process')), 80, 400)
dumpWin('#11 could-not-refresh-login', b248.indexOf(Buffer.from('Could not refresh your login because another Claude Code process')), 80, 400)

dumpFnExact('#37 O decidedBy', 196193850, 800)
dumpWin('#37 O-win', 196193850, 20, 500)

dumpFnExact('#38 Nde', b248.indexOf(Buffer.from('function Nde(){return v_()')), 400)
dumpWin('#38 Nde-win', b248.indexOf(Buffer.from('function Nde()')), 20, 250)

dumpWin('#42 safe-set', 179035300, 20, 500)

// MCP list heading
const mcp = allHits(b248, 'Manage MCP servers')
for (const [idx, i] of mcp.entries()) {
  if (i > 170000000) dumpWin(`#23 mcp-list#${idx}`, i, 200, 400)
}

// socket directory code hits
const sock = allHits(b248, 'socket directory')
for (const [idx, i] of sock.entries()) {
  if (i > 170000000) dumpWin(`#44 sock#${idx}`, i, 200, 300)
}

// F1t userns
const f1t = allHits(b248, 'function F1t(')
for (const [idx, i] of f1t.slice(0, 4).entries()) dumpFnExact(`#48 F1t#${idx}`, i, 1500)

writeFileSync(`${outDir}/gold-248-cache-3.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-cache-3.txt`, 'lines', lines.length)
