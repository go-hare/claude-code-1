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

const ko = 206910537
const so = 206910465

console.log('==== c bindings before ko ====')
for (const n of [
  'as c,',
  'as c}',
  'resolve as c',
  'function c(e,t)',
  'function c(t,e)',
  'c=function',
  'let c=',
  'var c=',
]) {
  const hits = allHits(n).filter(i => i > 206850000 && i < ko)
  console.log(n, hits)
  for (const i of hits.slice(-4)) console.log('  ', i, ascii(i - 70, i + 50))
}

const lastFrom = buf.lastIndexOf(Buffer.from('from"'), so)
console.log('\nlast from before $o', lastFrom, ascii(lastFrom - 300, lastFrom + 40))

writeFileSync(`${outDir}/gold-11-841-import.txt`, ascii(206905000, 206910000))
writeFileSync(`${outDir}/gold-11-JN-lock.txt`, ascii(206909850, 206910780))
