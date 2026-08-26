import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const needles = ['$ta(', 'Nta(', 'Lta(', 'applyMarketplace']
const chunks = []
for (const n of needles) {
  const hits = []
  let from = 0
  const needle = Buffer.from(n)
  while (hits.length < 12) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    hits.push(i)
    from = i + 1
  }
  chunks.push(`#### ${n} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    chunks.push(`\n==== ${n} ${i} ====`)
    chunks.push(printable(buf.slice(Math.max(0, i - 100), i + 180).toString('utf8')))
  }
  chunks.push('')
}
writeFileSync(new URL('./gold-pluginroot3.txt', import.meta.url), chunks.join('\n'))
console.log('ok')
