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

function extractFrom(offset, max = 12000) {
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

const win = (hits) => hits.filter(i => i > 210530000 && i < 210570000)

for (const n of [
  'async function eo(e,n){',
  'function no(',
  'async function no(',
  'function ro(',
  'async function ro(',
  'function xS()',
  'xS as',
  'function D3o',
  'mkdtemp as D3o',
  'function Kn(',
  'async function Kn(e){',
]) {
  const hits = allHits(n)
  const w = win(hits)
  console.log(n, 'win', w, 'n', hits.length)
  for (const i of (w.length ? w : hits.slice(0, 1))) {
    console.log('@', i, ascii(i, i + 200))
  }
}

const eo = allHits('async function eo(e,n){let{gitDir:t,commonDir:r}=e')[0]
writeFileSync(base + 'gold-forged-TCt-eo.txt', extractFrom(eo, 8000))
console.log('eo len', extractFrom(eo, 8000).length)

const noHits = win(allHits('function no('))
const roHits = win(allHits('function ro('))
if (noHits[0]) writeFileSync(base + 'gold-forged-TCt-Y4n-no.txt', extractFrom(noHits[0], 1500))
if (roHits[0]) writeFileSync(base + 'gold-forged-TCt-Z4n-ro.txt', extractFrom(roHits[0], 1500))

const xo = allHits('function _Xo(e){')[0]
writeFileSync(base + 'gold-forged-TCt-_Xo.txt', extractFrom(xo, 800))
const j4 = allHits('function j4n(e,t="changed")')[0]
writeFileSync(base + 'gold-forged-TCt-j4n.txt', extractFrom(j4, 1200))
const iXo = allHits('async function iXo(e){')[0]
writeFileSync(base + 'gold-forged-TCt-iXo.txt', extractFrom(iXo, 2000))
const p4 = allHits('async function P4n(e,t,n,r)')[0]
writeFileSync(base + 'gold-forged-TCt-P4n.txt', extractFrom(p4, 2000))
console.log({ noHits, roHits, eo, xo, j4, iXo })
