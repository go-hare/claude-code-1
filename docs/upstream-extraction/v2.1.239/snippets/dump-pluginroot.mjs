import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = [
  'aQ_=',
  'aQ_=new',
  '$ta(',
  'function $ta',
  'Lta(e.metadata.pluginRoot)',
  'Bare source names resolve',
  'I9u=',
]

const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 6) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + needle.length
  }
  chunks.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(printable(buf.slice(Math.max(0, i - 120), i + 500).toString('utf8')))
  }
  chunks.push('')
}

// Also dump JS around $ta call after marketplace parse
const i = buf.indexOf(Buffer.from('$ta('))
chunks.push('\n==== first $ta( wider ====\n')
chunks.push(printable(buf.slice(Math.max(0, i - 400), i + 200).toString('utf8')))

writeFileSync(new URL('./gold-pluginroot.txt', import.meta.url), chunks.join('\n'))
console.log('ok', { i })
