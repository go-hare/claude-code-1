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

function extractFrom(offset, max = 2500) {
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

console.log('=== function Vm(e,t) ===')
for (const i of allHits('function Vm(e,t)')) {
  console.log(i, ascii(i, i + 100))
}

console.log('=== function Qi(e,t) ===')
for (const i of allHits('function Qi(e,t)').slice(0, 20)) {
  console.log(i, ascii(i, i + 120))
}

console.log('=== function Ji(e,t) ===')
for (const i of allHits('function Ji(e,t)').slice(0, 20)) {
  console.log(i, ascii(i, i + 120))
}

console.log('=== function Ie(){ near 2105-2108 ===')
for (const i of allHits('function Ie(){')) {
  if (i > 210500000 && i < 210900000) console.log(i, ascii(i, i + 200))
}

console.log('=== function Pe(){return near 2107 ===')
for (const i of allHits('function Pe(){return')) {
  console.log(i, ascii(i, i + 160))
}

// {written
for (const n of ['{written:', '{written:!', 'written:!0', '.written', 'reason:"already_tracked"']) {
  const hits = allHits(n)
  console.log(n, hits.length, hits.slice(0, 6))
}

// identity record
for (const n of ['identity-record', 'osLinkedRootRealpaths.set', 'dev,s.ino', 'function wv']) {
  console.log(n, allHits(n).slice(0, 8))
}

// Lo full
writeFileSync(
  `${outDir}/gold-2-Lo-full.txt`,
  extractFrom(buf.indexOf(Buffer.from('async function Lo(e){if(!te())return!0'))),
)

// failedTipIds class
writeFileSync(
  `${outDir}/gold-2-failedSet-wide.txt`,
  ascii(222269510 - 600, 222269510 + 500),
)

// tips module imports: look ~222228000
writeFileSync(
  `${outDir}/gold-2-tips-mod-head.txt`,
  ascii(222228000, 222229200),
)
