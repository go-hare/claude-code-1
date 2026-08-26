import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  'function Vu(',
  'function ELe(',
  'dYb=',
  'dL="',
  'function g_a(',
  'sending to yourself',
  'message to yourself',
  'your own session',
  'DHm()',
  'self.token',
  'self.name',
  'openSync(Qe,"wx")',
  'config.worktree',
  'ensureWorktreeConfig',
  'wx")',
]

const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 4) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  chunks.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(
      printable(buf.slice(Math.max(0, i - 180), i + 700).toString('utf8')),
    )
  }
  chunks.push('')
}

writeFileSync(new URL('./gold-continue8.txt', import.meta.url), chunks.join('\n'))
console.log('ok')
