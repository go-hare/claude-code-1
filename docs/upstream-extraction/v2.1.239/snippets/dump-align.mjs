import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  'function Nta(',
  'function $ta(',
  'function Lta(',
  'function MVo(',
  'function jo(',
  'Bare source names resolve under metadata.pluginRoot',
  'a message to it would be a message to yourself',
  'This process\'s main session is',
  '15 minutes',
  'posix_spawn',
  'config.worktree',
  'removed worktree',
  'function V1w(',
  'function G1w(',
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
    chunks.push(printable(buf.slice(Math.max(0, i - 60), i + 900).toString('utf8')))
  }
  chunks.push('')
}

writeFileSync(new URL('./gold-align.txt', import.meta.url), chunks.join('\n'))
console.log('wrote gold-align.txt')
