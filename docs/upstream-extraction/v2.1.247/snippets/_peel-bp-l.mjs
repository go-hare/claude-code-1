import { readFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

for (const n of [
  'function bp(',
  'function $l(',
  'bp=function',
  '$l=function',
]) {
  const hits = allHits(n).filter(i => i > 214800000 && i < 215280000)
  console.log(n, hits)
  for (const i of hits.slice(0, 4)) console.log('  ', i, ascii(i, i + 180))
}

// imports of bp $l before TCt
const lastFrom = buf.lastIndexOf(Buffer.from('from"'), 215257791)
console.log('\nimport window', ascii(lastFrom - 500, lastFrom + 20))
