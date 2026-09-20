import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

const ae = buf.indexOf(Buffer.from('function ae(e,t,r=40,n=t)'))
const xe = buf.indexOf(Buffer.from('function xe(e,t,r=t){if(!ae(Ir.test'))
const ne = buf.indexOf(Buffer.from('function ne(e,t){if(!ae(e,t))return!0'))
console.log({ ae, xe, ne })

// import window immediately before Dr/Ve/ne/ae
writeFileSync(`${outDir}/gold-11-ae-imports.txt`, ascii(ae - 2500, ae + 80))

console.log('\n==== as J / as F near _752 ae ====')
for (const n of ['as J}', 'as J,', '{J as', 'as F}', 'as F,', '{F as', 'Pxd as', 'Qxd as']) {
  const hits = allHits(n).filter(i => i > ae - 8000 && i < ae)
  console.log(n, hits)
  for (const i of hits) console.log('  ', i, ascii(i - 80, i + 40))
}

console.log('\n==== function $o / function J(){return!1} ====')
for (const n of [
  'function $o(',
  'function $o()',
  '$o=function',
  'function J(){return!1}',
  'function J(e){return!1}',
  'function N(){return null}',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.slice(0, 3)) console.log('  ', i, ascii(i, i + 200))
}

console.log('\n==== Do= / F= near ae ====')
for (const n of ['function Do(e,t)', 'Do=F', 'F=Qxd', 'J=Pxd', ',F as', 'Pxd as J', 'Qxd as F']) {
  const hits = allHits(n).filter(i => Math.abs(i - ae) < 20000)
  console.log(n, hits)
  for (const i of hits) console.log('  ', i, ascii(i - 60, i + 80))
}
