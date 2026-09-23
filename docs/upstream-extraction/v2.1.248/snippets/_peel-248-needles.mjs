import { mkdirSync, readFileSync, writeFileSync } from 'fs'

const exe =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const outDir = 'docs/upstream-extraction/v2.1.248/snippets'
mkdirSync(outDir, { recursive: true })
const buf = readFileSync(exe)

function asciiSlice(src, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(src.length, end)
  for (let j = a; j < b; j++) {
    const c = src[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(src, needle) {
  const n = Buffer.from(needle)
  const hits = []
  let i = 0
  while (i < src.length) {
    const k = src.indexOf(n, i)
    if (k < 0) break
    hits.push(k)
    i = k + n.length
  }
  return hits
}

const needles = [
  ['#1 --restricted', '--restricted'],
  ['#1 CLAUDE_CODE_RESTRICTED', 'CLAUDE_CODE_RESTRICTED'],
  ['#2 experimental.cacheTtl', 'experimental.cacheTtl'],
  ['#2 cacheTtl', 'cacheTtl'],
  ['#3 --client-label', '--client-label'],
  ['#3 SELF_HOSTED_RUNNER_CLIENT_LABEL', 'SELF_HOSTED_RUNNER_CLIENT_LABEL'],
  ['#4 managed settings fail', 'managed settings'],
  ['#5 workflow scope', 'workflow'],
  ['#6 AWS Marketplace', 'AWS Marketplace'],
  ['#6 usage-credits', 'usage-credits'],
  ['#7 SendMessage', 'SendMessage'],
  ['#7 ListAgents', 'ListAgents'],
  ['#8 tool definitions', 'tool definitions'],
  ['#9 ScheduleWakeup', 'ScheduleWakeup'],
  ['#10 desktopSessionCleanupPeriodDays', 'desktopSessionCleanupPeriodDays'],
  ['#10 desktopSessionCleanup', 'desktopSessionCleanup'],
  ['#11 refresh lock', 'refresh lock'],
  ['#13 Console sign-in', 'Console sign-in'],
  ['#14 [1m]', '[1m]'],
  ['#16 PR-status', 'PR-status'],
  ['#16 pr status cache', 'prStatus'],
  ['#19 open in a terminal', 'open in a terminal'],
  ['#20 not pushed anywhere', 'not pushed anywhere'],
  ['#22 hook error', 'hook error'],
  ['#23 claude.ai', 'claude.ai'],
  ['#24 headersHelper', 'headersHelper'],
  [
    '#26 GATEWAY_MODEL_DISCOVERY',
    'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY',
  ],
  ['#27 mouse tracking', 'mouse tracking'],
  ['#29 Press Ctrl-C again', 'Press Ctrl-C again to exit'],
  ['#30 prod.env', 'prod.env'],
  ['#30 tfvars', '.tfvars'],
  ['#31 Remote Control', 'Remote Control'],
  ['#32 session credentials', 'session credentials'],
  ['#33 --spawn', '--spawn'],
  ['#37 crossSessionInbound', 'crossSessionInbound'],
  ['#38 DISABLE_EXTRA_USAGE_COMMAND', 'DISABLE_EXTRA_USAGE_COMMAND'],
  ['#39 No conversation found', 'No conversation found'],
  ['#40 workflow-authoring', 'workflow-authoring'],
  ['#41 PR badge', 'PR badge'],
  ['#42 stream-watchdog', 'stream-watchdog'],
  ['#42 STREAM_WATCHDOG', 'STREAM_WATCHDOG'],
  ['#43 ultrareview', 'ultrareview'],
  ['#44 private /tmp', 'per-user'],
  ['#45 shift+enter', 'shift+enter'],
  ['#46 self-paced', 'self-paced'],
  ['#47 [Anthropic telemetry]', '[Anthropic telemetry]'],
  ['#47 [3P telemetry]', '[3P telemetry]'],
  ['#48 user namespace', 'user namespace'],
  ['#49 parent session', 'parent session'],
  ['#49 delivered to the parent', 'delivered to the parent'],
]

const lines = [
  '# densable 2.1.248 SEA first-pass needles',
  `exe=${exe}`,
  `bytes=${buf.length}`,
  `when=${new Date().toISOString()}`,
  '',
]

for (const [label, needle] of needles) {
  const hits = allHits(buf, needle)
  lines.push(`## ${label}  needle=${JSON.stringify(needle)}  hits=${hits.length}`)
  for (const [idx, off] of hits.slice(0, 6).entries()) {
    lines.push(
      `- #${idx} @${off} ${asciiSlice(buf, off - 60, off + needle.length + 80)}`,
    )
  }
  if (hits.length > 6) lines.push(`- … +${hits.length - 6} more`)
  lines.push('')
}

const out = `${outDir}/gold-248-needles.txt`
writeFileSync(out, lines.join('\n'))
console.log(`WROTE ${out} lines=${lines.length}`)
