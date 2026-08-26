import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  'function nuy(',
  'function ueu(',
  'function OMo(',
  'tengu_goal_restored_on_resume',
  'origin:"restored"',
  'resume_swap',
  'function wro(',
  'function Sro(',
  'function HFe(',
  'goal_status',
]

const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 2) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  chunks.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(
      printable(buf.slice(Math.max(0, i - 80), i + 1800).toString('utf8')),
    )
  }
  chunks.push('')
}

writeFileSync(new URL('./gold-goal-restore.txt', import.meta.url), chunks.join('\n'))
console.log('ok')
