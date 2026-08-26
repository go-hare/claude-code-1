import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  // #10 jetbrains
  'JetBrains',
  'jetbrains',
  'edit write',
  'isJetBrains',
  // #11 esc queued
  'queued prompt',
  'cancel queued',
  'abort queued',
  // #20 dark-ansi
  'dark-ansi',
  'expanded tool',
  // #24 insights tags
  '<tag>',
  'literal tag',
  '/insights',
  // #27 theme badge
  'ultracode',
  'effortBadge',
  'badgeColor',
  // #28 otel
  'PreToolUse',
  'deferred by',
  // #30 selection:copy
  'selection:copy',
  'selectionCopy',
  // #37 hooks cwd
  'posix_spawn',
  'Hooks: cwd',
  // #39 title sync
  'title sync',
  'session-title',
  'titleUpdate',
  // #42 masked
  'masked',
  'killHistory',
  // #44 org policy
  'organization policy',
  'org policy',
  // #45 compact reminder
  'after compaction',
  'skill arguments',
  // #46 truncate middle
  'truncateMiddle',
  'truncatePathMiddle',
  // #47 keepalive
  'keep-alives',
  'SessionStart',
  // #49 goal resume
  'restoreGoal',
  'active goal',
  // #1 cost
  'us-only',
  'usOnly',
  '1.1',
  'data-residency',
  // #26 mouse
  '35;150;7M',
  'mouse report',
]

const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 3) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  chunks.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(
      printable(buf.slice(Math.max(0, i - 180), i + 900).toString('utf8')),
    )
  }
  chunks.push('')
}

writeFileSync(
  new URL('./gold-continue15.txt', import.meta.url),
  chunks.join('\n'),
)
console.log('ok', chunks.length)
