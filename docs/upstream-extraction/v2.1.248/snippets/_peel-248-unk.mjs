/**
 * densable 2.1.248 UNKNOWN re-peel — #8 #9 #14 #23 #24 #25 #28 #31 #36
 * Prior: gold-248-cache-verdict / agents-verdict / na-table
 * Contract: unique 248 SEA body only. Never invent. #24 confirm leftover only.
 */
import { existsSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const h = createRequire(import.meta.url)('./_peel-248-na-helpers.mjs')

const b248 = h.loadSea(h.EXE_248)
const b247 = existsSync(h.EXE_247) ? h.loadSea(h.EXE_247) : null

const lines = []
const stamp = new Date().toISOString()
lines.push(`# gold-248-unk-scan  densable 2.1.248 UNKNOWN re-peel`)
lines.push(`# SEA 226708128 · 247 ${b247 ? '253204128' : 'MISS'}`)
lines.push(`# when=${stamp}`)
lines.push(`# items=#8 #9 #14 #23 #24 #25 #28 #31 #36`)
lines.push(`# NEVER HAVE — unique 248 body only`)
lines.push('')

function dumpHits(tag, needle) {
  const a = h.allHits(b248, needle)
  const b = b247 ? h.allHits(b247, needle).length : 'NA'
  lines.push(`## ${tag}  needle=${JSON.stringify(needle)}  hits248=${a.length}  hits247=${b}`)
  for (const i of a.slice(0, 6)) {
    lines.push(`- @${i} ${h.asciiSlice(b248, i - 40, i + needle.length + 80)}`)
  }
  if (a.length > 6) lines.push(`- … +${a.length - 6} more`)
  lines.push('')
  return a
}

function dumpWin(tag, i, before = 80, after = 400) {
  if (i < 0) {
    lines.push(`## ${tag} MISS`)
    lines.push('')
    return
  }
  lines.push(`## ${tag} @${i}`)
  lines.push(h.asciiSlice(b248, i - before, i + after))
  lines.push('')
}

function dumpFn(tag, i, maxLen = 12000) {
  const ex = h.extractFnAt(b248, i, maxLen)
  if (ex.miss || ex.missEnd) {
    lines.push(`## ${tag} EXTRACT FAIL @${i} ${JSON.stringify(ex).slice(0, 200)}`)
    lines.push('')
    return ex
  }
  const hits247 = b247 ? h.allHits(b247, ex.body).length : 'NA'
  lines.push(`## ${tag} @${i} len=${ex.len} sha=${ex.sha} bodyHits247=${hits247}`)
  lines.push(ex.body.slice(0, 900))
  if (ex.body.length > 900) lines.push(`… +${ex.body.length - 900} chars`)
  lines.push('')
  return { ...ex, bodyHits247: hits247 }
}

function lastFn(before, names, maxLookback = 8000) {
  const r = h.lastFnStart(b248, before, names)
  if (r.i >= 0) return r
  return h.lastFnStartGeneric(b248, before, maxLookback)
}

function unique248(needle) {
  const a = h.allHits(b248, needle)
  if (!b247) return a
  return a.filter((i) => {
    const win = h.asciiSlice(b248, i, i + needle.length)
    return h.allHits(b247, win).length === 0
  })
}

// ---------------------------------------------------------------------------
// #8 oauth-refresh-tool-cache
// leftover: clearToolSchemaCache on OAuth save. Need unique re-render/cache-miss body.
// ---------------------------------------------------------------------------
lines.push('# ---- #8 oauth-refresh-tool-cache ----')
dumpHits('#8 clearToolSchemaCache', 'clearToolSchemaCache')
dumpHits('#8 getToolSchemaCache', 'getToolSchemaCache')
dumpHits('#8 TOOL_SCHEMA_CACHE', 'TOOL_SCHEMA_CACHE')
dumpHits('#8 tengu_oauth_tokens_saved', 'tengu_oauth_tokens_saved')
dumpHits('#8 clearBetasCaches', 'clearBetasCaches')
dumpHits('#8 getClaudeAIOAuthTokens.cache', 'getClaudeAIOAuthTokens')
dumpHits('#8 tool schema cache', 'tool schema cache')
dumpHits('#8 schema cache', 'schema cache')
dumpHits('#8 memoiz', 'memoiz')
dumpHits('#8 first render', 'first render')
dumpHits('#8 mid-session', 'mid-session')
dumpHits('#8 after an OAuth token', 'after an OAuth token')
dumpHits('#8 tool definitions being re-rendered', 'tool definitions being re-rendered')
dumpHits('#8 re-rendered after', 're-rendered after')
dumpHits('#8 skipClear', 'skipClear')
dumpHits('#8 preserveTool', 'preserveTool')
dumpHits('#8 oauthRefreshTool', 'oauthRefreshTool')
dumpHits('#8 toolsHash latch', 'toolsHash')
dumpHits('#8 should1hCacheTTL', 'should1hCacheTTL')
dumpHits('#8 latched session-stable', 'session-stable')
dumpHits('#8 sticky-on', 'sticky-on')

{
  const hits = h.allHits(b248, 'tengu_oauth_tokens_saved')
  for (const i of hits) {
    if (i < 170000000) continue
    const fn = lastFn(i, ['function '], 4000)
    dumpWin(`#8 tokens_saved-win`, i, 200, 500)
    if (fn.i > 0) dumpFn(`#8 tokens_saved-fn ${fn.name}`, fn.i, 6000)
  }
}

{
  // Compare oauth-save window vs 247: does 248 still clear tool schema cache?
  const n = 'tengu_oauth_tokens_saved'
  const a248 = h.allHits(b248, n).filter((i) => i > 170000000)
  const a247 = b247 ? h.allHits(b247, n).filter((i) => i > 170000000) : []
  for (const i of a248) {
    const win = h.asciiSlice(b248, i - 400, i + 400)
    lines.push(`## #8 248 oauth-save window @${i}`)
    lines.push(win)
    lines.push('')
  }
  for (const i of a247) {
    const win = h.asciiSlice(b247, i - 400, i + 400)
    lines.push(`## #8 247 oauth-save window @${i}`)
    lines.push(win)
    lines.push('')
  }
}

// ---------------------------------------------------------------------------
// #9 wakeup-resume-cache
// leftover: ScheduleWakeup overage prompt. Need --resume def-stability body.
// ---------------------------------------------------------------------------
lines.push('# ---- #9 wakeup-resume-cache ----')
dumpHits('#9 ScheduleWakeup', 'ScheduleWakeup')
dumpHits('#9 function k5n', 'function k5n(')
dumpHits('#9 guidance here stays', "the guidance here stays the same")
dumpHits('#9 resume first turn', 'resumed session')
dumpHits('#9 --resume', '--resume')
dumpHits('#9 definition changing', 'definition changing')
dumpHits('#9 tool definition', 'tool definition')
dumpHits('#9 cache miss on the', 'cache miss on the')
dumpHits('#9 first turn', 'first turn')
dumpHits('#9 session-stable overage', 'session-stable')
dumpHits('#9 latch overage', 'latch')
dumpHits('#9 resolveScheduleWakeup', 'resolveScheduleWakeup')
dumpHits('#9 DUe(', 'function DUe(')
dumpHits('#9 FKu(', 'function FKu(')
dumpHits('#9 EU_(', 'function EU_(')
dumpHits('#9 BKu(', 'function BKu(')
dumpHits('#9 Cfr(', 'function Cfr(')

{
  const k5 = h.allHits(b248, 'function k5n(')
  for (const i of k5) dumpFn('#9 k5n', i, 16000)
  // 247 equivalent: search DELAY_1H unique sentence
  if (b247) {
    const g = "the guidance here stays the same"
    const h247 = h.allHits(b247, g)
    for (const i of h247) {
      const fn = h.lastFnStartGeneric(b247, i, 8000)
      lines.push(`## #9 247 guidance-fn ${fn.name} @${fn.i}`)
      const ex = h.extractFnAt(b247, fn.i, 16000)
      if (ex.body) {
        lines.push(`len=${ex.len} sha=${ex.sha}`)
        lines.push(ex.body.slice(0, 400))
      }
      lines.push('')
    }
  }
}

{
  const g = "If the session enters usage overage"
  dumpHits('#9 overage delay sentence', g)
  const a = h.allHits(b248, g)
  for (const i of a) {
    const fn = lastFn(i, ['function k5n(', 'function '], 8000)
    dumpFn(`#9 overage-delay-fn ${fn.name}`, fn.i, 16000)
  }
}

// ---------------------------------------------------------------------------
// #14 model-name-code
// JKt bold only. Need model name as code so [1m] is not a link.
// ---------------------------------------------------------------------------
lines.push('# ---- #14 model-name-code ----')
dumpHits('#14 function JKt(', 'function JKt(')
dumpHits('#14 function Dv(', 'function Dv(')
dumpHits('#14 Fast mode ON', 'Fast mode ON')
dumpHits('#14 [1m]', '[1m]')
dumpHits('#14 sonnet[1m]', 'sonnet[1m]')
dumpHits('#14 backtick sonnet', '`sonnet')
dumpHits('#14 render as code', 'render as code')
dumpHits('#14 as code', ' as code')
dumpHits('#14 markdown code', 'markdown code')
dumpHits('#14 children:[`', 'children:[`')
dumpHits('#14 Code component', 'createElement(Code')
dumpHits('#14 <Code', '<Code')
dumpHits('#14 inverse', 'inverse:')
dumpHits('#14 wrapCode', 'wrapCode')
dumpHits('#14 asCode', 'asCode')
dumpHits('#14 code wrap', 'code wrap')
dumpHits('#14 OSC8', 'OSC8')
dumpHits('#14 ](1m', '](1m')
dumpHits('#14 markdown link 1m', '](1m]')
dumpHits('#14 href 1m]', '1m]')

{
  const jkt = h.allHits(b248, 'function JKt(')
  for (const i of jkt) dumpFn('#14 JKt', i, 4000)
  const dv = h.allHits(b248, 'function Dv(')
  for (const i of dv.slice(0, 6)) dumpFn('#14 Dv', i, 2000)
}

{
  // Fast mode notice with model name nearby
  const hits = h.allHits(b248, 'fast-mode-toggled')
  for (const i of hits.filter((x) => x > 170000000)) {
    dumpWin('#14 fast-mode-toggled-win', i, 80, 500)
    const fn = lastFn(i, ['function '], 3000)
    if (fn.i > 0) dumpFn(`#14 fast-mode-fn ${fn.name}`, fn.i, 4000)
  }
}

{
  const hits = h.allHits(b248, 'model-switch-fast-mode')
  for (const i of hits.filter((x) => x > 170000000)) {
    dumpWin('#14 model-switch-win', i, 80, 400)
  }
}

// Search unique 248 markdown-code wrappers around model display
for (const n of [
  '`$',
  'children:[`',
  'bold:!0,children:',
  'code:!0',
  'type:"code"',
  'kind:"code"',
]) {
  dumpHits(`#14 wrap ${n}`, n)
}

// ---------------------------------------------------------------------------
// #23 mcp-fake-claude-ai
// leftover: MCPListPanel forces claude.ai. Need heading/scope split.
// ---------------------------------------------------------------------------
lines.push('# ---- #23 mcp-fake-claude-ai ----')
dumpHits('#23 claude.ai', 'claude.ai')
dumpHits('#23 claudeai-proxy', 'claudeai-proxy')
dumpHits('#23 Manage MCP servers', 'Manage MCP servers')
dumpHits('#23 Project MCPs', 'Project MCPs')
dumpHits('#23 User MCPs', 'User MCPs')
dumpHits('#23 enterpriseManaged', 'enterpriseManaged')
dumpHits('#23 real scope', 'real scope')
dumpHits('#23 trusted heading', 'trusted heading')
dumpHits('#23 type==="claudeai-proxy"', 'type==="claudeai-proxy"')
dumpHits('#23 type!=="claudeai-proxy"', 'type!=="claudeai-proxy"')
dumpHits('#23 !=="claudeai-proxy"', '!=="claudeai-proxy"')
dumpHits('#23 official connector', 'official connector')
dumpHits('#23 fake connector', 'fake connector')
dumpHits('#23 connector type', 'connector type')
dumpHits('#23 .mcp.json', '.mcp.json')

{
  const hits = h.allHits(b248, 'Manage MCP servers')
  for (const i of hits.filter((x) => x > 170000000)) {
    dumpWin('#23 manage-mcp-win', i, 200, 800)
    const fn = lastFn(i, ['function '], 6000)
    if (fn.i > 0) dumpFn(`#23 manage-mcp-fn ${fn.name}`, fn.i, 8000)
  }
}

{
  // Compare 247 vs 248 grouping around claudeai-proxy filter
  const n = 'claudeai-proxy'
  const a248 = h.allHits(b248, n).filter((i) => i > 180000000)
  const a247 = b247 ? h.allHits(b247, n).filter((i) => i > 180000000) : []
  lines.push(`## #23 claudeai-proxy code hits 248=${a248.length} 247=${a247.length}`)
  for (const i of a248.slice(0, 8)) {
    dumpWin(`#23 248 proxy @${i}`, i, 120, 220)
  }
  for (const i of a247.slice(0, 8)) {
    lines.push(`## #23 247 proxy @${i}`)
    lines.push(h.asciiSlice(b247, i - 120, i + 220))
    lines.push('')
  }
}

// ---------------------------------------------------------------------------
// #24 headershelper-401 — CONFIRM leftover. Do NOT implement. Stay UNKNOWN.
// ---------------------------------------------------------------------------
lines.push('# ---- #24 headershelper-401 CONFIRM leftover ----')
dumpHits('#24 re-running headersHelper', 're-running headersHelper')
dumpHits('#24 tengu_mcp_headers_helper_retry', 'tengu_mcp_headers_helper_retry')
dumpHits('#24 classifyAuthReconnectKind', 'classifyAuthReconnectKind')
dumpHits('#24 mcp_headers_helper', 'mcp_headers_helper')
dumpHits('#24 Authorization header already', 'Authorization header')
dumpHits('#24 startOAuth discovery', 'OAuth discovery')

{
  const hits = h.allHits(b248, 're-running headersHelper')
  for (const i of hits) {
    dumpWin('#24 re-run-win', i, 80, 300)
    const fn = lastFn(i, ['function ', 'async function '], 8000)
    if (fn.i > 0) {
      const ex = dumpFn(`#24 re-run-fn ${fn.name}`, fn.i, 12000)
      if (b247 && ex.body) {
        const h247 = h.allHits(b247, ex.body).length
        lines.push(`## #24 body exact in 247: ${h247}`)
      }
    }
  }
}

if (b247) {
  const n = 're-running headersHelper'
  const a247 = h.allHits(b247, n)
  for (const i of a247) {
    lines.push(`## #24 247 re-run @${i}`)
    lines.push(h.asciiSlice(b247, i - 80, i + 300))
    lines.push('')
  }
}

// ---------------------------------------------------------------------------
// #25 login-gateway-hang
// leftover: unanswered managed-settings dialog. Need hang-fix body.
// ---------------------------------------------------------------------------
lines.push('# ---- #25 login-gateway-hang ----')
dumpHits('#25 [gateway-login]', '[gateway-login]')
dumpHits('#25 Managed-settings consent dialog exited without an answer', 'Managed-settings consent dialog exited without an answer')
dumpHits('#25 deferred_no_consent_surface', 'deferred_no_consent_surface')
dumpHits('#25 showManagedSettingsSecurityDialog', 'showManagedSettingsSecurityDialog')
dumpHits('#25 forceLoginGatewayUrl', 'forceLoginGatewayUrl')
dumpHits('#25 hang', 'hanging')
dumpHits('#25 login hang', 'login hang')
dumpHits('#25 skip security', 'skip security')
dumpHits('#25 skipSecurity', 'skipSecurity')
dumpHits('#25 during login', 'during login')
dumpHits('#25 login in progress', 'login in progress')
dumpHits('#25 consent during login', 'consent during')
dumpHits('#25 noConsentSurface', 'noConsentSurface')
dumpHits('#25 Claude apps gateway', 'Claude apps gateway')

{
  const hits = h.allHits(b248, 'Managed-settings consent dialog exited without an answer')
  for (const i of hits) {
    dumpWin('#25 unanswered-win', i, 80, 200)
    const fn = lastFn(i, ['async function ', 'function '], 4000)
    if (fn.i > 0) dumpFn(`#25 unanswered-fn ${fn.name}`, fn.i, 4000)
  }
}

{
  const hits = h.allHits(b248, '[gateway-login]')
  const codeHits = hits.filter((i) => i > 170000000)
  lines.push(`## #25 [gateway-login] code hits ${codeHits.length}`)
  for (const i of codeHits.slice(0, 10)) {
    dumpWin(`#25 gw-login @${i}`, i, 60, 200)
  }
}

// ---------------------------------------------------------------------------
// #28 trust-emoji-trunc
// mid-emoji is old changelog. Need TrustDialog grapheme cut body.
// ---------------------------------------------------------------------------
lines.push('# ---- #28 trust-emoji-trunc ----')
dumpHits('#28 cut off mid-emoji', 'cut off mid-emoji')
dumpHits('#28 TrustDialog', 'TrustDialog')
dumpHits('#28 tengu_trust_dialog_shown', 'tengu_trust_dialog_shown')
dumpHits('#28 permission rules', 'permission rules')
dumpHits('#28 repo permission', 'repo permission')
dumpHits('#28 toWellFormed', 'toWellFormed')
dumpHits('#28 Intl.Segmenter', 'Intl.Segmenter')
dumpHits('#28 granularity:"grapheme"', 'granularity:"grapheme"')
dumpHits('#28 granularity: "grapheme"', "granularity: 'grapheme'")
dumpHits('#28 grapheme', 'grapheme')
dumpHits('#28 ACCESSING_CAPABILITY', 'ACCESSING_CAPABILITY')
dumpHits('#28 Quick safety check', 'Quick safety check')
dumpHits('#28 Claude Code\'ll', "Claude Code'll")

{
  const hits = h.allHits(b248, 'tengu_trust_dialog_shown')
  for (const i of hits.filter((x) => x > 170000000)) {
    dumpWin('#28 trust-shown-win', i, 80, 400)
    const fn = lastFn(i, ['function '], 8000)
    if (fn.i > 0) dumpFn(`#28 trust-shown-fn ${fn.name}`, fn.i, 8000)
  }
}

{
  // Search TrustDialog rule list truncation — leftover PermissionDialog?
  const needles = [
    'Allow rules',
    'allow rules',
    'permission rule',
    'Bash(',
    'slice(0,',
    'truncateToWidth',
    'toWellFormed',
  ]
  for (const n of needles) dumpHits(`#28 extra ${n}`, n)
}

// Look at mid-emoji window to confirm changelog embed
{
  const hits = h.allHits(b248, 'cut off mid-emoji')
  for (const i of hits) dumpWin('#28 mid-emoji-win', i, 200, 200)
}

// ---------------------------------------------------------------------------
// #31 rc-reconnect-prompt
// changelog sentence in 247. Need unique 248 reconnect-repaint. leftover replBridge.
// ---------------------------------------------------------------------------
lines.push('# ---- #31 rc-reconnect-prompt ----')
dumpHits('#31 silently reconnect', 'silently reconnect')
dumpHits('#31 tengu_bridge_reconnected', 'tengu_bridge_reconnected')
dumpHits('#31 tengu_bridge_repl_reconnected_in_place', 'tengu_bridge_repl_reconnected_in_place')
dumpHits('#31 getPendingPermissionRequests', 'getPendingPermissionRequests')
dumpHits('#31 republishSurviving', 'republishSurviving')
dumpHits('#31 flushPendingReceipts', 'flushPendingReceipts')
dumpHits('#31 after silent', 'after silent')
dumpHits('#31 permission prompt', 'permission prompt')
dumpHits('#31 latest messages', 'latest messages')
dumpHits('#31 connected device', 'connected device')
dumpHits('#31 repaint', 'repaint')
dumpHits('#31 forceRender', 'forceRender')
dumpHits('#31 forceUpdate', 'forceUpdate')
dumpHits('#31 onReconnect', 'onReconnect')
dumpHits('#31 afterReconnect', 'afterReconnect')
dumpHits('#31 resync', 'resync')
dumpHits('#31 replay permission', 'replay permission')
dumpHits('#31 flushGate', 'flushGate')
dumpHits('#31 undeliveredResponses', 'undeliveredResponses')

{
  const hits = h.allHits(b248, 'tengu_bridge_reconnected')
  for (const i of hits.filter((x) => x > 170000000)) {
    dumpWin('#31 reconnected-win', i, 80, 400)
    const fn = lastFn(i, ['function ', 'async function '], 6000)
    if (fn.i > 0) {
      const ex = dumpFn(`#31 reconnected-fn ${fn.name}`, fn.i, 8000)
      if (b247 && ex.body) {
        lines.push(`## #31 reconnected bodyHits247=${h.allHits(b247, ex.body).length}`)
      }
    }
  }
}

{
  const hits = h.allHits(b248, 'tengu_bridge_repl_reconnected_in_place')
  for (const i of hits.filter((x) => x > 170000000)) {
    dumpWin('#31 in-place-win', i, 80, 300)
    const fn = lastFn(i, ['async function ', 'function '], 6000)
    if (fn.i > 0) dumpFn(`#31 in-place-fn ${fn.name}`, fn.i, 8000)
  }
}

if (b247) {
  const n = 'tengu_bridge_reconnected'
  const a248 = h.allHits(b248, n).filter((i) => i > 170000000)
  const a247 = h.allHits(b247, n).filter((i) => i > 170000000)
  lines.push(`## #31 tengu_bridge_reconnected code 248=${a248.length} 247=${a247.length}`)
  for (const i of a247) {
    lines.push(`## #31 247 reconnected @${i}`)
    lines.push(h.asciiSlice(b247, i - 80, i + 400))
    lines.push('')
  }
}

// ---------------------------------------------------------------------------
// #36 mention-ime
// non-Latin is old kitty changelog. Need @mention IME fold body.
// ---------------------------------------------------------------------------
lines.push('# ---- #36 mention-ime ----')
dumpHits('#36 mentionQuery', 'mentionQuery')
dumpHits('#36 tengu_at_mention_peer_', 'tengu_at_mention_peer_')
dumpHits('#36 non-Latin', 'non-Latin')
dumpHits('#36 IME', 'IME')
dumpHits('#36 toLocaleLowerCase', 'toLocaleLowerCase')
dumpHits('#36 localeCompare', 'localeCompare')
dumpHits('#36 normalize("NFKD"', 'normalize("NFKD"')
dumpHits('#36 normalize("NFD"', 'normalize("NFD"')
dumpHits('#36 normalize("NFKC"', 'normalize("NFKC"')
dumpHits('#36 normalize("NFC"', 'normalize("NFC"')
dumpHits('#36 hangul', 'hangul')
dumpHits('#36 Hangul', 'Hangul')
dumpHits('#36 Korean', 'Korean')
dumpHits('#36 composition', 'composition')
dumpHits('#36 isComposing', 'isComposing')
dumpHits('#36 foldCase mention', 'foldCase')
dumpHits('#36 peer_mention', 'peer_mention')
dumpHits('#36 @mention', '@mention')
dumpHits('#36 @-mention', '@-mention')

{
  const hits = h.allHits(b248, 'tengu_at_mention_peer_')
  for (const i of hits.filter((x) => x > 170000000)) {
    dumpWin('#36 mention-analytics-win', i, 80, 300)
    const fn = lastFn(i, ['function '], 4000)
    if (fn.i > 0) dumpFn(`#36 mention-fn ${fn.name}`, fn.i, 6000)
  }
}

{
  const nfkc = h.allHits(b248, 'normalize("NFKC")')
  const nfkc2 = h.allHits(b248, "normalize('NFKC')")
  lines.push(`## #36 NFKC hits dquote=${nfkc.length} squote=${nfkc2.length}`)
  for (const i of [...nfkc, ...nfkc2].filter((x) => x > 170000000).slice(0, 8)) {
    dumpWin(`#36 NFKC @${i}`, i, 80, 200)
    const fn = lastFn(i, ['function '], 2000)
    if (fn.i > 0) dumpFn(`#36 NFKC-fn ${fn.name}`, fn.i, 2000)
  }
}

if (b247) {
  const n = 'tengu_at_mention_peer_'
  const a248 = h.allHits(b248, n).filter((i) => i > 170000000)
  const a247 = h.allHits(b247, n).filter((i) => i > 170000000)
  lines.push(`## #36 mention analytics code 248=${a248.length} 247=${a247.length}`)
}

const out = join(here, 'gold-248-unk-scan.txt')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`wrote ${out} lines=${lines.length}`)
