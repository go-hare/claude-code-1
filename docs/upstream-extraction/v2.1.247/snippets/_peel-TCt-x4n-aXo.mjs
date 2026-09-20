import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const base = 'docs/upstream-extraction/v2.1.247/snippets/'

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

function extractFrom(offset, max = 8000) {
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

for (const n of [
  'x4n=class',
  'class x4n',
  'function aXo(',
  'function Q3o(',
  'function J3o(',
  'sXo=',
  'rYn=',
  'function fj(',
  'lXo=',
  'function hCt(',
]) {
  const hits = allHits(n).filter(i => i > 215220000 && i < 215280000)
  console.log(n, hits)
  for (const i of hits.slice(0, 1)) console.log(ascii(i, i + 220))
}

const cls = allHits('x4n=class x4n')[0] ?? allHits('class x4n')[0]
if (cls) {
  writeFileSync(base + 'gold-forged-TCt-x4n.txt', ascii(cls, cls + 1800))
  console.log('x4n', cls)
}

const fj = allHits('function fj(){')[0]
if (fj) writeFileSync(base + 'gold-forged-TCt-fj.txt', ascii(fj, fj + 400))

const hct = allHits('function hCt(){')[0]
if (hct) writeFileSync(base + 'gold-forged-TCt-hCt.txt', ascii(hct, hct + 500))
