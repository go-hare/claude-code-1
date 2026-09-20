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
  'async function T4n(',
  'function T4n(',
  'async function $4n(',
  'function $4n(',
  'async function cXo(',
  'async function wXo(',
  'async function vXo(',
  'async function U4n(',
  'function B4n(',
  'async function JS(',
  'function JS(',
  'async function eo(',
  'async function Y4n(',
  'function Y4n(',
  'function lYn(',
  'async function $4n',
]) {
  const hits = allHits(n)
  const win = hits.filter(i => i > 215220000 && i < 215280000)
  console.log(n, 'win', win, 'all0', hits.slice(0, 6))
  for (const i of (win.length ? win : hits).slice(0, 2)) {
    console.log('@', i, ascii(i, i + 160))
  }
}

const dumps = [
  ['async function T4n(', 'gold-forged-TCt-T4n.txt', 4000],
  ['async function $4n(', 'gold-forged-TCt-dollar4n.txt', 5000],
  ['async function cXo(', 'gold-forged-TCt-cXo.txt', 3500],
  ['async function wXo(', 'gold-forged-TCt-wXo.txt', 800],
  ['async function vXo(', 'gold-forged-TCt-vXo.txt', 2500],
  ['async function U4n(', 'gold-forged-TCt-U4n.txt', 4000],
  ['function B4n(', 'gold-forged-TCt-B4n.txt', 1500],
  ['async function JS(', 'gold-forged-TCt-JS.txt', 2500],
  ['function lYn(', 'gold-forged-TCt-lYn.txt', 600],
  ['function Y4n(', 'gold-forged-TCt-Y4n.txt', 800],
]

for (const [needle, name, max] of dumps) {
  const hits = allHits(needle)
  const pick =
    hits.find(i => i > 215220000 && i < 215280000) ?? hits[0]
  if (pick === undefined) {
    console.log('MISSING', needle)
    continue
  }
  writeFileSync(base + name, extractFrom(pick, max))
  console.log('wrote', name, pick, extractFrom(pick, 80).slice(0, 70))
}
