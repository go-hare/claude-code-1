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

// _580 export EGb
const egb = allHits('as EGb')
console.log('as EGb', egb)
for (const i of egb.slice(0, 6)) console.log(ascii(i - 80, i + 30))

const expE = buf.indexOf(Buffer.from(' as EGb'))
console.log('first as EGb', expE, ascii(expE - 200, expE + 40))

// Xi inspect near hs
for (const n of [
  'async function Xi(',
  'function Xi(',
  'async function Xi',
]) {
  const hits = allHits(n).filter(i => i > 210700000 && i < 210744000)
  console.log(n, hits)
  for (const i of hits) console.log(ascii(i, i + 200))
}

// sA formatter
for (const n of ['function sA(', 'function sA(e)']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 5))
  for (const i of hits.slice(0, 2)) {
    console.log(ascii(i, i + 250))
    writeFileSync(`${outDir}/gold-forged-sA.txt`, extractFrom(i, 800))
  }
}
