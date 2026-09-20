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

function extractFrom(offset, max = 3000) {
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

// hs: r=(s)=>on(s)||  @210729859+
console.log(ascii(210728200, 210729900))

for (const n of [
  'function on(e)',
  'function on(s)',
  'function on(t)',
  'on=e=>',
]) {
  const hits = allHits(n).filter(i => i > 210700000 && i < 210744200)
  console.log(n, hits)
  for (const i of hits) console.log('  ', ascii(i, i + 300))
}

// credential path helper names near hs
for (const n of ['credential', 'isCredential', '.env', 'id_rsa']) {
  const hits = allHits(n).filter(i => i > 210720000 && i < 210736000)
  if (hits.length) console.log(n, hits.slice(0, 6))
}

// SXo refuse message builder
const sxo = allHits('function SXo(')
console.log('SXo', sxo)
for (const i of sxo.slice(0, 3)) {
  console.log(ascii(i, i + 400))
  writeFileSync(`${outDir}/gold-forged-SXo.txt`, extractFrom(i, 1500))
}
