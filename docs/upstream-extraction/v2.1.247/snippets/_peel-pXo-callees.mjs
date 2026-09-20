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

function extractFn(start, max = 8000) {
  let i = start
  let depth = 0
  let seen = false
  while (i < start + max && i < buf.length) {
    const c = buf[i]
    if (c === 123) {
      depth++
      seen = true
    } else if (c === 125) {
      depth--
      if (seen && depth === 0) return ascii(start, i + 1)
    }
    i++
  }
  return ascii(start, Math.min(start + max, buf.length))
}

function writeUnique(label, needle, out, max) {
  const hits = allHits(needle)
  console.log(label, needle, hits)
  if (hits.length !== 1) {
    console.log('NOT UNIQUE', label, hits.length)
    return hits
  }
  const body = extractFn(hits[0], max)
  writeFileSync(base + out, body)
  console.log('wrote', out, hits[0], body.length)
  return hits
}

writeUnique('pXo', 'function pXo(e){', 'gold-forged-pXo.txt', 800)
writeUnique('fXo', 'function fXo(e){', 'gold-forged-fXo.txt', 4000)

const lo = 210500000
const hi = 210570000

function writeScoped(label, needle, out, max) {
  const hits = allHits(needle).filter(i => i > lo && i < hi)
  console.log(label, needle, hits)
  if (hits.length !== 1) {
    console.log('NOT UNIQUE IN _583', label, hits)
    return hits
  }
  const body = extractFn(hits[0], max)
  writeFileSync(base + out, body)
  console.log('wrote', out, hits[0], body.length)
  return hits
}

writeScoped('G4n/Ri', 'function Ri(e){', 'gold-forged-G4n.txt', 800)
writeScoped('q4n/Pn', 'function Pn(){', 'gold-forged-q4n.txt', 200)
writeScoped('V4n/Rn', 'function Rn(e){', 'gold-forged-V4n.txt', 300)

const k = allHits('K=["CLAUDE_CONFIG_DIR"')
console.log('W4n/K', k)
if (k.length === 1) {
  writeFileSync(base + 'gold-forged-W4n.txt', ascii(k[0], k[0] + 119))
}

const pi = allHits('Pi=[...K,...Lt,')
console.log('bCt/Pi', pi)
if (pi.length === 1) {
  writeFileSync(
    base + 'gold-forged-bCt.txt',
    ascii(210540648, 210540648 + 360).replace(/}\);import[\s\S]*$/, ''),
  )
}

const xr = allHits('function h(e){return Lr(e,p())}')
console.log('Xr/_705.h', xr)
writeFileSync(
  base + 'gold-forged-Xr.txt',
  [
    '# Xr is not a unique function name (20 hits). Do not invent a parser.',
    '# TCt import: vGc as Xr from _705.js @212842061',
    '# _583 import: vGc as ee from _705.js (same export; Ft uses ee(t)?.env)',
    '# _705 export: h as vGc @208321399',
    '# _705 API: getSettingsForSource:()=>h @208304369',
    '# wrapper @208306694 — local host is getSettingsForSource',
    xr[0] === undefined ? '' : extractFn(xr[0], 80),
    '',
  ].join('\n'),
)

console.log('\n==== TCt pXo call ====')
const call = allHits('pXo(h)')
console.log('pXo(h)', call)
for (const i of call) console.log(ascii(i - 80, i + 280))
