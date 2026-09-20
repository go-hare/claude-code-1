import { readFileSync, writeFileSync, existsSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = existsSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
  ? readFileSync(
      'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
    )
  : null

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function count(buf, needle) {
  const n = Buffer.from(needle)
  let i = 0
  let c = 0
  while (true) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    c++
    i = j + n.length
    if (c > 80) return `${c}+`
  }
  return c
}

function first(buf, needle) {
  return buf.indexOf(Buffer.from(needle))
}

function allOffsets(buf, needle, max = 8) {
  const n = Buffer.from(needle)
  const out = []
  let i = 0
  while (out.length < max) {
    const j = buf.indexOf(n, i)
    if (j < 0) break
    out.push(j)
    i = j + n.length
  }
  return out
}

const extra = [
  '967',
  '934',
  '0.967',
  '0.934',
  '967000',
  '934000',
  '33000',
  '66000',
  '65000',
  '33001',
  'AUTO_COMPACT',
  'autoCompactThreshold',
  'getAutoCompact',
  'COMPACT_THRESHOLD',
  'reservedTokens',
  'Message from',
  'from @:',
  'peer message',
  'peerMessage',
  'PeerMessage',
  'cross-session',
  'crossSession',
  'inbox message',
  'configured MCP server',
  'MCP connection failed',
  'mcp_connection',
  'failedConnecting',
  'mcpServersFailed',
  'failedMcp',
  'under a minute',
  'PR status',
  'prStatus',
  'githubPr',
  'lastPrCheck',
  'PR_CHECK',
  '60000',
  '60_000',
  'force gateway',
  'forceGateway',
  'gateway login',
  'customOauth',
  'custom OAuth',
  'disableAnalytics',
  'analyticsDisabled',
  'isAnalyticsDisabled',
  'managed settings',
  'managedSettings',
  'organization requires',
  'sign-in enforcement',
  'must sign in',
  'org enforcement',
  'policySettings',
  'administrator',
]

console.log('=== extra counts ===')
for (const n of extra) {
  const c247 = count(buf247, n)
  const c246 = buf246 ? count(buf246, n) : 'NA'
  const changed =
    c247 !== c246 ? '  ***' : ''
  if (c247 !== 0 || c246 !== 0) {
    console.log(JSON.stringify(n).padEnd(30), '247=', String(c247).padStart(4), '246=', String(c246).padStart(4), changed)
  }
}

function dumpHits(label, needle, before, after, max = 3) {
  const offs = allOffsets(buf247, needle, max)
  if (offs.length === 0) {
    console.log('MISS dump', label)
    return
  }
  let body = `# needle=${JSON.stringify(needle)} hits=${offs.length}\n`
  for (const i of offs) {
    body += `\n===== offset=${i} =====\n`
    body += asciiWindow(buf247, Math.max(0, i - before), i + after)
    body += '\n'
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${label}`,
    body,
  )
  console.log('DUMP', label, offs)
}

dumpHits('gold-under-a-minute.txt', 'under a minute', 4000, 2000, 2)
dumpHits('gold-configured-mcp.txt', 'configured MCP', 2500, 1500, 3)
dumpHits('gold-custom-oauth.txt', 'custom OAuth', 4000, 2000, 2)
dumpHits('gold-message-from.txt', 'Message from', 2500, 1500, 5)
dumpHits('gold-cannot-be-read.txt', 'cannot be read', 2000, 800, 8)
dumpHits('gold-telemetry-disabled.txt', 'telemetry disabled', 3000, 1500, 3)
dumpHits('gold-refocus.txt', 'refocus', 2500, 1500, 3)
