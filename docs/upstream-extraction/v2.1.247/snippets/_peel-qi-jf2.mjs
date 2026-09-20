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

const ae = 208253529

console.log('==== _841 / _752 imports before ae ====')
for (const n of [
  '_841.js',
  '_752.js',
  'Pxd as J',
  'Qxd as F',
  'Pxd as',
  'Qxd as',
  'as J,',
  'as F,',
  'as J}',
  'as F}',
]) {
  const hits = allHits(n).filter(i => i > 207800000 && i < ae)
  console.log(n, hits.slice(-8))
  for (const i of hits.slice(-3)) console.log('  ', i, ascii(i - 40, i + 60))
}

// last import before ae
const lastImport = buf.lastIndexOf(Buffer.from('from"'), ae)
console.log('\nlast from" before ae', lastImport, ascii(lastImport - 200, lastImport + 80))

// search J= and F= assignments in module
console.log('\n==== J=/F= between last big import and ae ====')
for (const n of ['J=Pxd', 'F=Qxd', 'J=$o', 'F=ko', ',J,', 'let J=', 'var J=', 'J=function']) {
  const hits = allHits(n).filter(i => i > 208000000 && i < ae + 500)
  console.log(n, hits)
}

// window 208200000-208252000 looking for import { ... J ...
writeFileSync(`${outDir}/gold-11-ae-mod-pre.txt`, ascii(208200000, 208210000))
writeFileSync(`${outDir}/gold-11-ae-mod-pre2.txt`, ascii(208240000, 208252200))

// find module start: // @bun or import{ near 2081
for (const n of ['// @bun', 'import{', 'from"B:/~BUN/root/_841']) {
  const hits = allHits(n).filter(i => i > 208100000 && i < ae)
  console.log(n, 'count', hits.length, 'last', hits.slice(-5))
}
