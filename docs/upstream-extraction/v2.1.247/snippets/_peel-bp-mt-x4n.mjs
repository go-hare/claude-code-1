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

// Walk back from H as Wzd export to find function H
console.log('==== walk back for H ====')
const exp = 206472545
console.log(ascii(exp - 2500, exp + 30))

writeFileSync(`${outDir}/gold-forged-H-Wzd-mod.txt`, ascii(206460000, 206473000))

// sA uses bp($l(r), nYn)
const sa = allHits('function sA(')
console.log('sA', sa)
for (const i of sa.slice(0, 2)) console.log(ascii(i, i + 250))

// pluralize: 1===e?t:n  or e===1?t
for (const n of [
  'function mt(e,t,n=t)',
  'function mt(e,t,n){return',
  'e===1?t:n',
  'e===1?t:',
  '1===e?t:n',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 6))
  for (const i of hits.slice(0, 2)) console.log(ascii(i - 40, i + 120))
}

// seed-admin maker around 210554633 (K4n module) and 215262551 (TCt)
console.log('\n==== seed-admin @210554 ====')
console.log(ascii(210553800, 210556200))
console.log('\n==== seed-admin @215262 ====')
console.log(ascii(215262400, 215263200))

// X4n alias
for (const n of [' as X4n', 'X4n as ', 'function X4n(', 'X4n=async']) {
  console.log(n, allHits(n).slice(0, 8))
}

// mn wide
const mn = buf.indexOf(Buffer.from('async function mn(e,{path:t,status:i,oldMode:n,newMode:r,oldId:a,newId:o}'))
console.log('\nmn at', mn)
if (mn > 0) {
  writeFileSync(`${outDir}/gold-forged-mn-wide.txt`, ascii(mn, mn + 3500))
  console.log(ascii(mn, mn + 800))
}

// Qt
console.log('\n==== Qt ====')
console.log(ascii(210742900, 210744200))

// Uc LEGACY
const uc = buf.indexOf(Buffer.from('function Uc('))
console.log('\nfunction Uc', uc, uc > 0 ? ascii(uc, uc + 200) : '')
for (const n of ['Uc=()=>', 'function Uc()', 'let Uc=', 'Uc=e=>']) {
  console.log(n, allHits(n).slice(0, 4))
}

// V.CLAUDE_CODE_LEGACY_BUNDLE definition
const vleg = allHits('CLAUDE_CODE_LEGACY_BUNDLE')
console.log('\nLEGACY hits', vleg)
for (const i of vleg) {
  console.log('---', i)
  console.log(ascii(i - 60, i + 80))
}
