import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)
function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const start = 322150190 // function oSn(
const end = Math.min(buf.length, start + 28000)
const body = printable(buf.slice(start, end).toString('utf8'))

const mYeHits = []
let from = start
while (mYeHits.length < 20) {
  const i = buf.indexOf(Buffer.from('mYe('), from)
  if (i < 0 || i > start + 28000) break
  mYeHits.push(i)
  from = i + 4
}

const gfsHits = []
from = start
while (gfsHits.length < 10) {
  const i = buf.indexOf(Buffer.from('gfs('), from)
  if (i < 0 || i > start + 28000) break
  gfsHits.push(i)
  from = i + 4
}

const extras = []
for (const n of [
  'function gfs(',
  'availableRows',
  'showing ',
  ' more above',
  'promptVisibleBelow',
  'workflow-detail-dialog',
]) {
  const hits = []
  let f = 0
  const needle = Buffer.from(n)
  while (hits.length < 3) {
    const i = buf.indexOf(needle, f)
    if (i < 0) break
    hits.push(i)
    f = i + needle.length
  }
  extras.push(`#### ${JSON.stringify(n)} ${hits.length} [${hits.join(', ')}]`)
  for (const i of hits) {
    extras.push(`\n==== ${n} ${i} ====`)
    extras.push(printable(buf.slice(Math.max(0, i - 120), i + 1600).toString('utf8')))
  }
}

writeFileSync(
  new URL('./gold-osn.txt', import.meta.url),
  [
    `mYe hits in oSn window: ${mYeHits.join(', ')}`,
    `gfs hits in oSn window: ${gfsHits.join(', ')}`,
    '',
    '==== oSn body ====',
    body,
    '',
    extras.join('\n'),
  ].join('\n'),
)
console.log('ok', body.length, mYeHits, gfsHits)
