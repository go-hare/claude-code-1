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

const block = ascii(209855800, 209858200)
writeFileSync(`${outDir}/gold-11-import-209856.txt`, block)
console.log(block)

console.log('\n==== module boundaries 209856-210370 ====')
for (const n of ['// @bun', 'export{', 'var av=le', 'le(()=>{']) {
  const hits = allHits(n).filter(i => i >= 209850000 && i <= 210380000)
  console.log(n, hits.slice(0, 15), 'count', hits.length)
}

console.log('\n==== mid-file imports 210370-210419 ====')
for (const i of allHits('import{').filter(x => x > 210370000 && x < 210419000)) {
  console.log(i, ascii(i, i + 180))
}

// source symbols
for (const n of [
  'function Z2c',
  'Z2c as Vm',
  'export{Z2c',
  'function $2c',
  'function Qxd',
  'function had',
  'had as wv',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 6))
}
