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

writeFileSync(`${outDir}/gold-11-ino-208.txt`, ascii(208226900, 208227400))
writeFileSync(`${outDir}/gold-2-firstparty-or.txt`, ascii(208569150, 208569400))
writeFileSync(`${outDir}/gold-2-firstparty-or2.txt`, ascii(208570230, 208570450))

for (const n of ['async function bt(', 'function bt(', 'function Ht(', 'function Ht()']) {
  const hits = allHits(n).filter(i => i > 208260000 && i < 208290000)
  console.log(n, hits)
}

// bt(t) used in Rt at ~208274900
{
  const i = 208274900
  const back = ascii(i - 4000, i)
  for (const needle of ['async function bt', 'function bt(', 'function Ht(', 'async function At']) {
    console.log('Rt back', needle, back.lastIndexOf(needle))
  }
}

writeFileSync(`${outDir}/gold-11-kv-helpers.txt`, ascii(208271800, 208274920))

// Pe Ie from firstParty or
for (const i of [208569217, 208570301, 210682152]) {
  console.log('ctx', i, ascii(i - 80, i + 80))
}

// search function Pe(){return get or firstParty
for (const n of [
  'function Pe(){return',
  'Pe(){return xn',
  '!=="firstParty"',
]) {
  console.log(n, allHits(n).length)
}
