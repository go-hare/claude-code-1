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

// walk back from {written:!0 at 208274921 to function
{
  const i = 208274921
  const back = ascii(i - 2500, i)
  const idx = back.lastIndexOf('function ')
  console.log('written back', back.slice(Math.max(0, idx - 20), idx + 180))
  if (idx >= 0) {
    const start = i - 2500 + idx
    writeFileSync(`${outDir}/gold-11-kv-written-fn.txt`, extractFrom(start, 5000))
    console.log('kv start', start)
  }
}

writeFileSync(`${outDir}/gold-11-written-wide.txt`, ascii(208273800, 208276200))

// .ino near 2103-2104 and 2082
for (const n of ['.ino', 'ino:', 'dev:', 'fstat', 'identity']) {
  const hits = allHits(n).filter(i => i > 208200000 && i < 210400000)
  console.log(n, 'in 2082-2104', hits.slice(0, 12), hits.length)
}

// tips imports
writeFileSync(`${outDir}/gold-2-tips-before-class.txt`, ascii(222268200, 222269700))

// Pe Ie as imported names in tips - search "Pe()" definition via export
for (const n of ['function Pe(){return"', 'getAPIProvider', '!=="firstParty"||!']) {
  console.log(n, allHits(n).slice(0, 5))
}

// filterCommandsForRemoteMode
console.log(
  'filterCommandsForRemoteMode',
  allHits('filterCommandsForRemoteMode').slice(0, 6),
)
console.log('te() in Lo', ascii(222272743, 222272900))
