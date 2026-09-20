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

function extractFrom(offset, max = 20000) {
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

// hs full dump by brace-unaware window
writeFileSync(`${outDir}/gold-forged-hs-wide.txt`, ascii(210729859, 210736030))
console.log('hs..Xi bytes', 210736023 - 210729859)

// Wi already know @210737166
writeFileSync(`${outDir}/gold-forged-Wi-wide.txt`, ascii(210737166, 210738200))

// K4n
for (const n of [
  'async function K4n(',
  'function K4n(',
  'as K4n,',
  'as K4n}',
  'K4n=async',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 6))
  for (const i of hits.slice(0, 2)) console.log('  ', i, ascii(i, i + 140))
}

// seed-admin
for (const n of ['seed-admin', 'claude-seed', '~/.claude/seed']) {
  const hits = allHits(n)
  console.log(JSON.stringify(n), hits.slice(0, 8))
  for (const i of hits.slice(0, 2)) console.log('  ', ascii(i - 40, i + 80))
}

// Wzd as bp @212858688 — TCt file
console.log('\n==== Wzd as bp ====')
console.log(ascii(212858640, 212858780))

// $l @212845935
console.log('\n==== $l import ====')
console.log(ascii(212845880, 212846000))

// sn neighborhood lists Yt zt rn tr Qt
writeFileSync(`${outDir}/gold-forged-sn-wide.txt`, ascii(210583410, 210588000))
console.log('\n==== sn + tables ====')
console.log(ascii(210583410, 210586200))
