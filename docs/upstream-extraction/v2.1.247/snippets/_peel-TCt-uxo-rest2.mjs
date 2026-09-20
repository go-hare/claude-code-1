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
  'async function P4n(',
  'function Y4n(',
  'Y4n=',
  'kXo=',
  'kXo=new',
  'var kXo',
  ' as JS',
  'JS as ',
  'async function JS(e,n',
  'function JS(e,n',
  'await JS(h',
  'async function iXo(',
  'function aXo(',
  'function xS(',
  'function Z4n(',
  'function _Xo(',
  'function j4n(',
  'async function eo(e,n)',
]) {
  const hits = allHits(n)
  const win = hits.filter(i => i > 210530000 && i < 215280000)
  console.log('\n====', n, 'win', win.slice(0, 6), 'n', hits.length)
  for (const i of (win.length ? win : hits).slice(0, 2)) {
    console.log('@', i, ascii(Math.max(0, i - 30), i + 180))
  }
}

const p4 = allHits('async function P4n(').find(i => i > 215230000)
if (p4) writeFileSync(base + 'gold-forged-TCt-P4n.txt', extractFrom(p4, 2500))

const eo = allHits('async function eo(e,n){let{gitDir:t,commonDir:r}=e')[0]
if (eo) writeFileSync(base + 'gold-forged-TCt-eo.txt', extractFrom(eo, 3500))

const jsCall = allHits('await JS(h')[0]
console.log('JS call', jsCall, jsCall && ascii(jsCall - 80, jsCall + 80))
