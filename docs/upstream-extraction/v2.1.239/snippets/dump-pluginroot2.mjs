import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  'function tQ_(',
  'lQ_',
  'aQ_.test',
  'startsWith("./")',
  'Relative path',
]

const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 5) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  chunks.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(printable(buf.slice(Math.max(0, i - 80), i + 700).toString('utf8')))
  }
  chunks.push('')
}

// marketplace schema Ltr around plugins transform
const i = buf.indexOf(Buffer.from('plugins:ft(Hn()).transform(tQ_)'))
chunks.push('\n==== plugins:ft(Hn()) ====\n')
if (i >= 0) {
  chunks.push(printable(buf.slice(i - 200, i + 800).toString('utf8')))
}

writeFileSync(new URL('./gold-pluginroot2.txt', import.meta.url), chunks.join('\n'))
console.log({ i })
