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

for (const n of [
  'async function ys(',
  'function ys(',
  'async function hs(',
]) {
  const hits = allHits(n).filter(i => i > 210700000 && i < 210750000)
  console.log(n, hits)
}

const ys = buf.indexOf(Buffer.from('async function ys('), 210700000)
console.log('ys', ys, ys > 0 ? ascii(ys, ys + 200) : '')
if (ys > 0) {
  writeFileSync(`${outDir}/gold-forged-ys.txt`, extractFrom(ys, 4000))
  console.log(extractFrom(ys, 2000))
}

// on() credential predicate used by hs
const onHits = allHits('function on(').filter(i => i > 210720000 && i < 210740000)
console.log('function on(', onHits)
for (const i of onHits) console.log(ascii(i, i + 250))

const on2 = allHits('on=function').filter(i => i > 210720000 && i < 210744000)
console.log('on=function', on2)
