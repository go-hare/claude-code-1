import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

const OUT = 'docs/upstream-extraction/v2.1.247/snippets'

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function dump(name, i, before, after) {
  const text = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(`${OUT}/${name}`, `# offset=${i}\n\n${text}\n`)
  console.log('DUMP', name, i)
  return text
}

function findAll(needle, limit = 20, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (hits.length < limit) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j > to) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

console.log('=== Io / Ur exact defs ===')
for (const pat of [
  'Io=p(()=>d({$schema',
  'Ur=p(()=>te(Mo,Io()))',
  'function Mo(e){',
  'function wo(e){',
  'function Po(e,t){',
  'function os(e){',
  'function ho(',
  'ho=p(',
  'ho=(',
]) {
  const hits = findAll(pat, 6, 207800000, 208000000)
  console.log(pat, hits)
}

const io = buf.indexOf(Buffer.from('Io=p(()=>d({$schema'), 207800000)
const ur = buf.indexOf(Buffer.from('Ur=p(()=>te(Mo,Io()))'), 207800000)
console.log('Io', io, 'Ur', ur)
if (io > 0) dump('gold-dig-QLn-Io-body.txt', io, 40, 2200)
if (ur > 0) dump('gold-dig-jS-Ur-body.txt', ur, 80, 200)

console.log('\n=== ho transform near Io ===')
const region = asciiWindow(buf, 207860000, 207916000)
for (const pat of ['function ho(', 'ho=p(', 'ho=e(', '.transform(ho)', 'var ho=', 'ho=(e']) {
  let idx = 0
  let n = 0
  while (n < 6) {
    const i = region.indexOf(pat, idx)
    if (i < 0) break
    console.log(pat, 207860000 + i, region.slice(i, i + 220).replace(/\n/g, ' '))
    idx = i + pat.length
    n++
  }
}

console.log('\n=== B() near Io plugins ===')
for (const pat of ['plugins:f(B())', 'B=p(', 'function B(', 'B=go', 'go=p(']) {
  const hits = findAll(pat, 8, 207800000, 208000000)
  console.log(pat, hits)
  for (const i of hits.slice(0, 2)) {
    console.log(' ', asciiWindow(buf, i, i + 120).replace(/\n/g, ' '))
  }
}

console.log('\n=== shadow wn/Me in marketplace mega-module ===')
const IMP = 212846176
const ST = 214540269
for (const pat of [
  'function wn(',
  'function Me(',
  'var wn=',
  'var Me=',
  'let wn=',
  'let Me=',
  'wn=p(',
  'Me=p(',
]) {
  const hits = findAll(pat, 15, IMP, ST)
  console.log(pat, hits)
}

console.log('\n=== _750 Zt / vc (i1c / l1c) ===')
const z750 = 206675950
dump('gold-dig-QLn-750-export.txt', z750, 200, 400)

for (const name of ['Zt', 'vc']) {
  console.log('---', name)
  for (const pat of [
    `function ${name}(`,
    `${name}=p(`,
    `var ${name}=`,
    `${name}=e(`,
    `${name}=(()=>`,
  ]) {
    const hits = findAll(pat, 8, 206400000, 206800000)
    for (const i of hits) {
      console.log(pat, i, asciiWindow(buf, i, i + 160).replace(/\n/g, ' '))
    }
  }
}

console.log('\n=== _716 import of zod / p / te / d / f ===')
// module containing Io starts before 207876150
const bun = findAll('// @bun @bytecode', 8, 207700000, 207880000)
console.log('bun headers', bun)
if (bun[0]) dump('gold-dig-QLn-716-modhead.txt', bun[0], 20, 2500)

console.log('\n=== te( / preprocess usage mapping ===')
for (const pat of ['te=e(', 'te=p(', 'function te(', 'preprocess:te', 'te as ']) {
  const hits = findAll(pat, 6, 207700000, 207920000)
  console.log(pat, hits)
}

console.log('\n=== $St Me(wn) vs other Me(wn) — confirm same-module bindings ===')
dump('gold-dig-QLn-dollarSt-extend.txt', 214540247, 20, 180)
