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

const imp = ascii(210369700, 210370400)
writeFileSync(`${outDir}/gold-11-sbx-import-fs.txt`, imp)
console.log(imp)
console.log('\n==== named import hunt ====')

for (const n of [
  'as Vm,',
  'as Vm}',
  '{Vm,',
  ',Vm,',
  ',Vm}',
  'as Ji,',
  'as Ji}',
  '{Ji,',
  ',Ji,',
  'as Qi,',
  'as Qi}',
  '{Qi,',
  ',Qi,',
  'as wv,',
  'as wv}',
  '{wv,',
  ',wv,',
  'as wv ',
]) {
  const hits = allHits(n).filter(i => i > 210350000 && i < 210430000)
  console.log(JSON.stringify(n), hits)
}

console.log('\n==== global as Vm / as Ji / as Qi / as wv (sandbox-ish) ====')
for (const n of ['as Vm,', 'as Vm}', 'as Ji,', 'as Ji}', 'as Qi,', 'as Qi}', 'as wv,', 'as wv}']) {
  const hits = allHits(n)
  console.log(n, hits.length, hits.slice(0, 12))
  for (const i of hits.slice(0, 8)) {
    console.log('   ', i, ascii(i - 60, i + 30))
  }
}

// no() full: skip default-param braces
console.log('\n==== no after yZ ====')
console.log(ascii(210370650, 210370800))

// nh(
console.log('\n==== function nh ====')
for (const i of allHits('function nh(').slice(0, 15)) {
  console.log(i, ascii(i, i + 160))
}

// th( used by _Z
console.log('\n==== function th(e,t) near sandbox ====')
for (const i of allHits('function th(e,t)')) {
  if (i > 208000000 && i < 212000000) console.log(i, ascii(i, i + 200))
}
