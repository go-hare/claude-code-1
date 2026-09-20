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

function extractFrom(offset, max = 5000) {
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

console.log('// @bun after 209853791')
console.log(allHits('// @bun').filter(i => i >= 209853791 && i < 210500000))

console.log('\nchunk paths')
for (const n of ['_752.js', '_841.js', '_806.js']) {
  const hits = allHits(`B:/~BUN/root/${n}`)
  console.log(n, hits.slice(0, 4))
}

for (const n of [
  'Z2c as',
  'export{Z2c',
  'Z2c,',
  '$2c as',
  'Qxd as',
  'had as',
  'function Z2c(',
  'function $2c(',
  'function Qxd(',
  'function had(',
  'Z2c=function',
  '$2c=function',
]) {
  console.log(n, allHits(n).slice(0, 8))
}

// export maps in those chunks
for (const n of ['export{', 'export {']) {
  // skip
}

// Find export lists containing Z2c
console.log('\n==== export lists with Z2c / $2c / Qxd / had ====')
for (const n of ['Z2c as', 'as Z2c}', 'as Z2c,', 'as $2c}', 'as $2c,', 'as Qxd}', 'as Qxd,', 'as had}', 'as had,']) {
  const hits = allHits(n)
  console.log(n, hits)
  for (const i of hits.slice(0, 4)) console.log('  ', ascii(i - 80, i + 40))
}
