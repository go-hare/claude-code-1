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

function extractFrom(offset, max = 4000) {
  let i = offset
  let depth = 0
  let seen = false
  while (i < offset + max && i < buf.length) {
    if (buf[i] === 123) {
      depth++
      seen = true
    } else if (buf[i] === 125) {
      depth--
      if (seen && depth === 0) return ascii(offset, i + 1)
    }
    i++
  }
  return ascii(offset, Math.min(offset + max, buf.length))
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

writeFileSync(`${outDir}/gold-11-ne-win.txt`, ascii(208252800, 208255000))
console.log('==== ne window ====')
console.log(ascii(208252800, 208255000))

writeFileSync(`${outDir}/gold-11-ko-win.txt`, ascii(206908800, 206911000))
console.log('\n==== ko window ====')
console.log(ascii(206908800, 206911000))

console.log('\n==== record( in _806 ====')
for (const i of allHits('.record(').filter(x => x > 207790000 && x < 207820000)) {
  console.log(i, ascii(i - 80, i + 120))
}

console.log('\n==== class / wt.of / record(e ====')
for (const n of [
  'record(e,t,r,n)',
  'record(e,',
  'class wt',
  'wt=class',
  'wt={',
  'of(Se().host)',
]) {
  const hits = allHits(n).filter(x => x > 207700000 && x < 207850000)
  console.log(n, hits)
  for (const i of hits.slice(0, 3)) console.log('  ', extractFrom(i > 20 ? i - 40 : i, 1500).slice(0, 400))
}

// ae/Dr/xe near ne
console.log('\n==== function ae / Dr / xe near ne ====')
for (const n of ['function ae(', 'function Dr(', 'function xe(']) {
  for (const i of allHits(n).filter(x => x > 208240000 && x < 208260000)) {
    console.log(i, extractFrom(i, 1500))
  }
}

console.log('\n==== function ae / c( near ko ====')
for (const n of ['function ae(', 'function c(', 'function N(', 'function J(']) {
  for (const i of allHits(n).filter(x => x > 206890000 && x < 206920000)) {
    console.log(n, i, extractFrom(i, 800))
  }
}
