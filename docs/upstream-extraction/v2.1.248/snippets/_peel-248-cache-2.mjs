// densable 2.1.248 peel pass2 — extract exact fn bodies + gap needles
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
  '# gold-248-cache-2  densable 2.1.248 pass2',
  `# bytes248=${b248.length} 247=${b247 ? b247.length : 'ABSENT'}`,
  `# when=${new Date().toISOString()}`,
  '# NEVER HAVE — peel only',
  '',
]

function dumpHits(label, needle, around = 80, cap = 6) {
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

function dumpFnExact(label, i, maxLen = 8000) {
  lines.push(`## ${label} @${i}`)
  const ext = extractFnAt(b248, i, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    lines.push(ext.body)
  } else lines.push(`MISS ${JSON.stringify(ext)}`)
  lines.push('')
  return ext
}

function dumpWin(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

const needles = [
  // #8
  ['#8 toolSchemasChanged', 'toolSchemasChanged'],
  ['#8 overageChanged', 'overageChanged'],
  ['#8 isUsingOverage', 'isUsingOverage'],
  ['#8 tengu_prompt_cache_break', 'tengu_prompt_cache_break'],
  ['#8 tools changed', 'tools changed'],
  ['#8 oauth refresh tools', 'oauth refresh'],
  ['#8 after refresh', 'after refresh'],
  ['#8 rebuild tools', 'rebuild tools'],
  ['#8 tool schema', 'tool schema'],

  // #9
  ['#9 5-minute TTL', '5-minute TTL'],
  ['#9 dropping to 5 minutes', 'dropping to 5 minutes'],
  ['#9 during usage overage', 'during usage overage'],
  ['#9 function k5n', 'function k5n('],

  // #11
  ['#11 proceeding without lock', 'proceeding without lock'],
  ['#11 skipping refresh', 'skipping refresh'],
  ['#11 retryable error', 'retryable error'],
  ['#11 token refresh lock', 'token refresh lock'],
  ['#11 oauth-refresh-', 'oauth-refresh-'],
  ['#11 mcp-refresh-', 'mcp-refresh-'],
  ['#11 forceLogin', 'forceLogin'],
  ['#11 needsOAuthRefresh', 'needsOAuthRefresh'],
  ['#11 another Claude Code process', 'another Claude Code process'],

  // #13
  ['#13 Keyless Console sign-in unavailable here', 'Keyless Console sign-in unavailable here'],
  ['#13 continuing with the API-key sign-in', 'continuing with the API-key sign-in'],
  ['#13 tengu_oauth_error', 'tengu_oauth_error'],
  ['#13 pin the login method', 'pin the login method'],

  // #22
  ['#22 treating as plain text', 'treating as plain text'],
  ['#22 Failed to parse hook output as JSON', 'Failed to parse hook output as JSON'],
  ['#22 Hook JSON output validation failed', 'Hook JSON output validation failed'],
  ['#22 Hook output does not start with', 'Hook output does not start with'],
  ['#22 parseHookOutput', 'parseHookOutput'],

  // #23
  ['#23 trusted heading', 'trusted heading'],
  ['#23 claude.ai"', 'claude.ai"'],
  ['#23 type:"claudeai-proxy"', 'type:"claudeai-proxy"'],
  ['#23 project mcp', 'project .mcp.json'],
  ['#23 scope project', 'scope:"project"'],
  ['#23 heading claude', '"claude.ai"'],

  // #24
  ['#24 classifyAuthReconnectKind', 'classifyAuthReconnectKind'],
  ['#24 mcp_headers_helper', 'mcp_headers_helper'],
  ['#24 tengu_mcp_headers_helper_retry', 'tengu_mcp_headers_helper_retry'],
  ['#24 Authorization header', 'Authorization header'],
  ['#24 hasAuthorization', 'hasAuthorization'],
  ['#24 startOAuth', 'startOAuth'],

  // #25
  ['#25 [gateway-login]', '[gateway-login]'],
  ['#25 Managed-settings consent dialog exited without an answer', 'Managed-settings consent dialog exited without an answer'],
  ['#25 managed-settings-security', 'managed-settings-security'],
  ['#25 showManagedSettingsSecurityDialog', 'showManagedSettingsSecurityDialog'],
  ['#25 deferred_no_consent_surface', 'deferred_no_consent_surface'],

  // #26
  ['#26 skipped: no credential', '[gatewayDiscovery] skipped: no credential'],
  ['#26 apiKeyHelper requires workspace trust', 'apiKeyHelper requires workspace trust'],
  ['#26 function su()', 'function su(){if(!a.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY)'],
  ['#26 async function c9n', 'async function c9n(e){if(!su())'],

  // #37
  ['#37 invalid-setting', 'invalid-setting'],
  ['#37 managed-setting', 'managed-setting'],
  ['#37 repo-setting', 'repo-setting'],
  ['#37 settings warning names the file', 'settings warning names the file'],

  // #38
  ['#38 function v_()', 'function v_(){if(a.DISABLE_EXTRA_USAGE_COMMAND)'],
  ['#38 run /usage-credits to ask', 'run /usage-credits to ask'],
  ['#38 run /usage-credits to raise', 'run /usage-credits to raise'],
  ['#38 run /usage-credits to adjust', 'run /usage-credits to adjust'],

  // #42
  ['#42 CLAUDE_ENABLE_STREAM_WATCHDOG in set', '"CLAUDE_ENABLE_STREAM_WATCHDOG"'],
  ['#42 MCP_STARTUP_MODE', 'MCP_STARTUP_MODE'],
  ['#42 CLAUDE_CODE_MCP_STARTUP', 'CLAUDE_CODE_MCP_STARTUP'],
  ['#42 startup_mode', 'startup_mode'],
  ['#42 CLAUDE_STREAM_IDLE_TIMEOUT_MS', 'CLAUDE_STREAM_IDLE_TIMEOUT_MS'],
  ['#42 API_TIMEOUT_MS', 'API_TIMEOUT_MS'],

  // #44
  ['#44 CLAUDE_CODE_TMPDIR', 'CLAUDE_CODE_TMPDIR'],
  ['#44 Point XDG_RUNTIME_DIR', 'Point XDG_RUNTIME_DIR'],
  ['#44 inbox directory', 'inbox directory'],
  ['#44 messaging directory', 'messaging directory'],
  ['#44 socket directory', 'socket directory'],
  ['#44 /tmp/claude', '/tmp/claude'],
  ['#44 private (0700)', 'private (0700)'],

  // #48
  ['#48 without a uid mapping', 'without a uid mapping'],
  ['#48 user namespace without', 'user namespace without'],
  ['#48 unshar', 'unshar'],
  ['#48 userns', 'userns'],
  ['#48 uid===0', 'uid===0'],
  ['#48 process.getuid', 'process.getuid'],
  ['#48 canonical system directories', 'canonical system directories'],

  // #49
  ['#49 parent session\'s conversation', "parent session's conversation"],
  ['#49 if you are a subagent', 'if you are a subagent'],
]

for (const [label, needle] of needles) dumpHits(label, needle)

// exact extracts
const exact = [
  ['#26 su', 180224462, 800],
  ['#26 c9n', 180225763, 4000],
  ['#38 Zur', 180726780, 400],
  ['#38 v_', 180726877, 400],
  ['#13 kxt', 193501380, 4000],
  ['#37 sne', 202504085, 2000],
  ['#37 Qje', 202716145, 2000],
  ['#49 Pe', 196262799, 6000],
  ['#8 d5e', 184452118, 8000],
  ['#9 k5n', 181122899, 12000],
]

for (const [label, i, maxLen] of exact) dumpFnExact(label, i, maxLen)

// Keyless code hits (skip string table < 170M)
const keyless = allHits(b248, 'Keyless Console sign-in unavailable here')
for (const [idx, i] of keyless.entries()) {
  dumpWin(`#13 Keyless-win#${idx}`, i, 500, 700)
  if (i > 170000000) {
    // walk back a short distance for function
    const win = asciiSlice(b248, i - 8000, i)
    const k = win.lastIndexOf('async function ')
    const k2 = win.lastIndexOf('function ')
    const rel = Math.max(k, k2)
    if (rel >= 0) dumpFnExact(`#13 Keyless-fn#${idx}`, i - 8000 + rel, 8000)
  }
}

// refresh lock code window
dumpWin('#11 lock-code', 206982305, 200, 2200)

// headersHelper 401 window
dumpWin('#24 headersHelper-401-code', 207115285, 400, 800)

// uid mapping fn
const uid = allHits(b248, 'without a uid mapping')
for (const [idx, i] of uid.entries()) {
  if (i > 170000000) {
    dumpWin(`#48 uid-win#${idx}`, i, 400, 600)
    const win = asciiSlice(b248, i - 4000, i)
    const rel = Math.max(win.lastIndexOf('function '), win.lastIndexOf('async function '))
    if (rel >= 0) dumpFnExact(`#48 uid-fn#${idx}`, i - 4000 + rel, 3000)
  }
}

// hook parse
const hookPlain = allHits(b248, 'treating as plain text')
for (const [idx, i] of hookPlain.entries()) {
  if (i > 170000000) {
    dumpWin(`#22 plain-win#${idx}`, i, 300, 500)
    const win = asciiSlice(b248, i - 4000, i)
    const rel = Math.max(win.lastIndexOf('function '), win.lastIndexOf('async function '))
    if (rel >= 0) dumpFnExact(`#22 plain-fn#${idx}`, i - 4000 + rel, 4000)
  }
}

const hookFail = allHits(b248, 'Failed to parse hook output as JSON')
for (const [idx, i] of hookFail.entries()) {
  if (i > 170000000) {
    dumpWin(`#22 failparse-win#${idx}`, i, 200, 400)
    const win = asciiSlice(b248, i - 4000, i)
    const rel = Math.max(win.lastIndexOf('function '), win.lastIndexOf('async function '))
    if (rel >= 0) dumpFnExact(`#22 failparse-fn#${idx}`, i - 4000 + rel, 4000)
  }
}

// invalid-setting decision
const inv = allHits(b248, 'invalid-setting')
for (const [idx, i] of inv.entries()) {
  if (i > 170000000) {
    dumpWin(`#37 invalid-win#${idx}`, i, 250, 250)
  }
}

writeFileSync(`${outDir}/gold-248-cache-2.txt`, lines.join('\n'))
console.log('WROTE', `${outDir}/gold-248-cache-2.txt`, 'lines', lines.length)
