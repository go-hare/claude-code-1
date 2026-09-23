// densable 2.1.248 peel — cache/auth/mcp/xsession batch
// #8 #9 #11 #13 #22 #23 #24 #25 #26 #37 #38 #42 #44 #48 #49
// helpers copied from v2.1.247/snippets/_peel-1-ye-Ht-Jt-DE.mjs
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

function lastFnStartBefore(buf, before, maxBack = 12000) {
  const winStart = Math.max(0, before - maxBack)
  const win = asciiSlice(buf, winStart, before)
  let best = -1
  for (const name of ['async function ', 'function ']) {
    let idx = 0
    while (true) {
      const k = win.lastIndexOf(name)
      // walk all occurrences
      break
    }
    let i = 0
    while (i < win.length) {
      const k = win.indexOf(name, i)
      if (k < 0) break
      const abs = winStart + k
      if (abs < before && abs > best) best = abs
      i = k + name.length
    }
  }
  return best
}

const lines = [
  '# gold-248-cache-1  densable 2.1.248',
  `# exe=${exe248} bytes=${b248.length}`,
  `# 247=${b247 ? `${exe247} bytes=${b247.length}` : 'ABSENT'}`,
  `# when=${new Date().toISOString()}`,
  '# helpers=asciiSlice/allHits/extractFnAt from _peel-1-ye-Ht-Jt-DE.mjs',
  '# items=#8 #9 #11 #13 #22 #23 #24 #25 #26 #37 #38 #42 #44 #48 #49',
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

function dumpFnNear(label, i, maxBack = 12000, maxLen = 8000) {
  lines.push(`## ${label} hit@${i}`)
  if (i < 0) {
    lines.push('MISS offset')
    lines.push('')
    return
  }
  const start = lastFnStartBefore(b248, i, maxBack)
  lines.push(`fnStart=${start} back=${i - (start < 0 ? i : start)}`)
  if (start < 0) {
    lines.push(asciiSlice(b248, i - 200, i + 400))
    lines.push('')
    return
  }
  const ext = extractFnAt(b248, start, maxLen)
  if (ext.body) {
    lines.push(`len=${ext.len} sha=${ext.sha}`)
    if (ext.len <= 4000) lines.push(ext.body)
    else {
      lines.push(ext.body.slice(0, 1800))
      lines.push('…[body truncated]…')
      lines.push(ext.body.slice(-800))
    }
  } else {
    lines.push(`MISS ${JSON.stringify(ext)}`)
    lines.push(asciiSlice(b248, start, start + 400))
  }
  lines.push('')
}

function dumpAround(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  if (i < 0) lines.push('MISS')
  else lines.push(asciiSlice(b248, i - before, i + after))
  lines.push('')
}

const needles = [
  // #8 oauth-refresh-tool-cache
  ['#8 lost thinking', 'lost thinking'],
  ['#8 lost extended', 'lost extended'],
  ['#8 extended-thinking', 'extended-thinking'],
  ['#8 extended thinking', 'extended thinking'],
  ['#8 prompt-cache miss', 'prompt-cache miss'],
  ['#8 prompt cache miss', 'prompt cache miss'],
  ['#8 cache miss', 'cache miss'],
  ['#8 OAuth token refresh', 'OAuth token refresh'],
  ['#8 oauth token refresh', 'oauth token refresh'],
  ['#8 after an OAuth', 'after an OAuth'],
  ['#8 tool definitions being', 'tool definitions being'],
  ['#8 re-rendered', 're-rendered'],
  ['#8 rerender', 'rerender'],
  ['#8 toolsFingerprint', 'toolsFingerprint'],
  ['#8 toolFingerprint', 'toolFingerprint'],
  ['#8 cacheControl', 'cacheControl'],
  ['#8 cache_control', 'cache_control'],
  ['#8 thinking context', 'thinking context'],
  ['#8 once an hour', 'once an hour'],
  ['#8 token refresh', 'token refresh'],
  ['#8 toolsHash', 'toolsHash'],
  ['#8 toolSchema', 'toolSchema'],
  ['#8 stabilizeTools', 'stabilizeTools'],
  ['#8 memoizeTools', 'memoizeTools'],

  // #9 wakeup-resume-cache
  ['#9 usage overage', 'usage overage'],
  ['#9 entered usage', 'entered usage'],
  ['#9 overage', 'overage'],
  ['#9 ScheduleWakeup', 'ScheduleWakeup'],
  ['#9 first-turn', 'first-turn'],
  ['#9 first turn', 'first turn'],
  ['#9 wakeup tool', 'wakeup tool'],
  ['#9 ScheduleWakeupInputError', 'ScheduleWakeupInputError'],

  // #11 refresh-lock-retry
  ['#11 Refresh lock held', 'Refresh lock held by another process'],
  ['#11 Could not acquire refresh lock after', 'Could not acquire refresh lock after'],
  ['#11 Another process already refreshed', 'Another process already refreshed tokens'],
  ['#11 Acquiring refresh lock', 'Acquiring refresh lock'],
  ['#11 skipping refresh', 'skipping refresh'],
  ['#11 retryable', 'retryable'],
  ['#11 session token had expired', 'session token had expired'],
  ['#11 token had expired', 'token had expired'],
  ['#11 login screen', 'login screen'],
  ['#11 sent to the login', 'sent to the login'],

  // #13 login-console-fallback
  ['#13 Keyless Console sign-in', 'Keyless Console sign-in unavailable here'],
  ['#13 API-key sign-in', 'API-key sign-in'],
  ['#13 ANTHROPIC_API_KEY is set in this environment', 'ANTHROPIC_API_KEY is set in this environment'],
  ['#13 api key helper', 'api key helper'],
  ['#13 API key helper', 'API key helper'],
  ['#13 cannot be used', 'cannot be used'],

  // #22 hook-invalid-json
  ["#22 isn't valid JSON", "isn't valid JSON"],
  ['#22 is not valid JSON', 'is not valid JSON'],
  ['#22 invalid JSON', 'invalid JSON'],
  ['#22 Unexpected token', 'Unexpected token'],
  ['#22 hook error with', 'hook error with'],
  ['#22 parse message', 'parse message'],
  ['#22 treating a stdout', 'treating a stdout'],
  ['#22 stdout {', 'stdout {'],

  // #23 mcp-fake-claude-ai
  ['#23 claude.ai connector', 'claude.ai connector'],
  ['#23 trusted claude.ai', 'trusted "claude.ai"'],
  ['#23 claude.ai heading', 'claude.ai" heading'],
  ['#23 connector type', 'connector type'],
  ['#23 claudeai', 'claudeai'],
  ['#23 type claudeai', 'type:"claudeai"'],
  ['#23 .mcp.json', '.mcp.json'],
  ['#23 real scope', 'real scope'],

  // #24 headershelper-401
  ['#24 re-running headersHelper', 're-running headersHelper'],
  ['#24 re-running the helper', 're-running the helper'],
  ['#24 OAuth discovery', 'OAuth discovery'],
  ['#24 falling into OAuth', 'falling into OAuth'],
  ['#24 headersHelper and retry', 'headersHelper and retry'],
  ['#24 retrying the call', 'retrying the call'],
  ['#24 retrying once', 'retrying once'],

  // #25 login-gateway-hang
  ['#25 Claude apps gateway', 'Claude apps gateway'],
  ['#25 apps gateway', 'apps gateway'],
  ['#25 managed-settings security approval', 'managed-settings security approval'],
  ['#25 approval dialog', 'approval dialog'],
  ['#25 security approval', 'security approval'],
  ['#25 gateway hanging', 'gateway hanging'],

  // #26 gateway-discovery-helper
  [
    '#26 GATEWAY_MODEL_DISCOVERY',
    'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY',
  ],
  ['#26 gatewayDiscovery', 'gatewayDiscovery'],
  ['#26 Skipped gateway', 'Skipped gateway'],
  ['#26 apiKeyHelper', 'apiKeyHelper'],

  // #37 crossSessionInbound
  [
    '#37 unrecognized crossSessionInbound',
    'unrecognized "crossSessionInbound"',
  ],
  [
    '#37 held while it is present',
    'messages are held while it is present',
  ],
  ['#37 until fixed', 'until fixed'],
  ['#37 crossSessionInbound', 'crossSessionInbound'],

  // #38 usage-credits-hint-gate
  ['#38 DISABLE_EXTRA_USAGE_COMMAND', 'DISABLE_EXTRA_USAGE_COMMAND'],
  ['#38 /usage-credits', '/usage-credits'],
  ['#38 run /usage-credits', 'run /usage-credits'],

  // #42 managed-env-no-approval
  ['#42 stream-watchdog', 'stream-watchdog'],
  ['#42 STREAM_WATCHDOG', 'STREAM_WATCHDOG'],
  ['#42 CLAUDE_ENABLE_STREAM_WATCHDOG', 'CLAUDE_ENABLE_STREAM_WATCHDOG'],
  ['#42 startup-mode', 'startup-mode'],
  ['#42 startupMode', 'startupMode'],
  ['#42 MCP startup', 'MCP startup'],
  ['#42 settings-approval', 'settings-approval'],
  ['#42 no longer trigger', 'no longer trigger'],
  ['#42 client-side timeout', 'client-side timeout'],
  ['#42 API_TIMEOUT', 'API_TIMEOUT'],

  // #44 xsession-tmp-fallback
  ['#44 per-user /tmp', 'per-user /tmp'],
  ['#44 private per-user', 'private per-user'],
  ['#44 inbox directory', 'inbox directory'],
  ['#44 cross-session messaging', 'cross-session messaging'],
  ['#44 XDG_RUNTIME_DIR', 'XDG_RUNTIME_DIR'],
  ['#44 the directory to fix', 'directory to fix'],
  ['#44 cannot use the default', 'cannot use the default'],

  // #48 linux-userns-trust
  ['#48 root-equivalent', 'root-equivalent'],
  ['#48 unmapped owners', 'unmapped owners'],
  ['#48 canonical system', 'canonical system'],
  ['#48 user namespace', 'user namespace'],
  ['#48 uid mapping', 'uid mapping'],
  ['#48 unmapped owner', 'unmapped owner'],
  ['#48 without a uid mapping', 'without a uid mapping'],

  // #49 sendmessage-parent-reply
  [
    '#49 delivered to the parent',
    "delivered to the parent session's conversation",
  ],
  ["#49 not to you", "not to you"],
  ["#49 parent session's address", "parent session's address"],
]

for (const [label, needle] of needles) dumpHits(label, needle)

// extract likely contract functions from unique/strong hits
const extractNeedles = [
  ['#13 Keyless Console sign-in unavailable here', 16000, 12000],
  ['#13 continuing with the API-key sign-in', 16000, 12000],
  ['ANTHROPIC_API_KEY is set in this environment and takes precedence', 16000, 8000],
  ['Refresh lock held by another process', 16000, 12000],
  ['Could not acquire refresh lock after', 16000, 12000],
  ['Another process already refreshed tokens', 16000, 12000],
  ['unrecognized "crossSessionInbound"', 16000, 8000],
  ['messages are held while it is present', 16000, 8000],
  ["delivered to the parent session's conversation", 16000, 8000],
  ['[gatewayDiscovery]', 12000, 8000],
  ['function su(){if(!a.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY)', 200, 4000],
  ['async function c9n(e){if(!su())', 200, 8000],
  ['function v_(){if(a.DISABLE_EXTRA_USAGE_COMMAND)', 200, 2000],
  ['re-running headersHelper', 16000, 8000],
  ["isn't valid JSON", 16000, 8000],
  ['is not valid JSON', 16000, 8000],
  ['claude.ai connector', 16000, 8000],
  ['root-equivalent', 16000, 8000],
  ['unmapped owners', 16000, 8000],
  ['canonical system', 16000, 8000],
  ['usage overage', 16000, 8000],
  ['lost thinking', 16000, 8000],
  ['re-rendered', 16000, 8000],
  ['prompt-cache miss', 16000, 8000],
  ['Claude apps gateway', 16000, 8000],
  ['security approval', 16000, 8000],
  ['approval dialog', 16000, 8000],
  ['per-user /tmp', 16000, 8000],
  ['private per-user', 16000, 8000],
]

for (const [needle, maxBack, maxLen] of extractNeedles) {
  const hits = allHits(b248, needle)
  if (hits.length === 0) {
    lines.push(`## EXTRACT ${JSON.stringify(needle)} hits=0`)
    lines.push('')
    continue
  }
  for (const [idx, i] of hits.slice(0, 3).entries()) {
    dumpFnNear(`EXTRACT ${JSON.stringify(needle)} #${idx}`, i, maxBack, maxLen)
  }
}

// wider windows on the strongest unique strings
const windows = [
  ['#13 Keyless', 'Keyless Console sign-in unavailable here', 400, 500],
  ['#13 APIKEY env', 'ANTHROPIC_API_KEY is set in this environment and takes precedence', 200, 600],
  ['#11 lock held', 'Refresh lock held by another process', 300, 500],
  ['#26 su()', 'function su(){if(!a.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY)', 20, 800],
  ['#26 c9n', 'async function c9n(e){if(!su())', 20, 1200],
  ['#38 v_()', 'function v_(){if(a.DISABLE_EXTRA_USAGE_COMMAND)', 20, 400],
  ['#37 unrecognized', 'unrecognized "crossSessionInbound"', 300, 400],
  ['#49 parent reply', "delivered to the parent session's conversation", 400, 400],
]
for (const [label, needle, before, after] of windows) {
  const i = b248.indexOf(Buffer.from(needle))
  dumpAround(label, i, before, after)
}

writeFileSync(`${outDir}/gold-248-cache-1.txt`, lines.join('\n'))
console.log(
  'WROTE',
  `${outDir}/gold-248-cache-1.txt`,
  'lines',
  lines.length,
  'bytes',
  lines.join('\n').length,
)
