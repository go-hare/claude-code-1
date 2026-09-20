import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

const base = 'docs/upstream-extraction/v2.1.247/snippets/'

writeFileSync(base + 'gold-forged-Pr.txt', extractFrom(210558974, 700))
writeFileSync(base + 'gold-forged-Vn.txt', extractFrom(210557990, 400))
writeFileSync(base + 'gold-forged-Gr.txt', extractFrom(210563156, 350))
writeFileSync(base + 'gold-forged-T.txt', extractFrom(210538905, 350))

console.log('==== find _583 @bun before V ====')
const v = 210541503
let bun = -1
for (let i = v; i > v - 200000 && i > 0; i--) {
  if (
    buf[i] === 47 &&
    buf[i + 1] === 47 &&
    buf[i + 2] === 32 &&
    buf[i + 3] === 64 &&
    buf[i + 4] === 98
  ) {
    bun = i
    break
  }
}
console.log('prev @bun', bun)
if (bun > 0) console.log(ascii(bun, bun + 2500))

console.log('\n==== imports Fe xe Ce Bn jn $e le cn ====')
for (const n of [
  ' as Fe,',
  ' as Fe}',
  ' as xe,',
  ' as xe}',
  ' as Ce,',
  ' as Ce}',
  ' as Bn,',
  ' as Bn}',
  ' as jn,',
  ' as jn}',
  ' as $e,',
  ' as $e}',
  ' as le,',
  ' as le}',
  ' as cn,',
  'function cn(e){',
  'function $e(e,n){',
  'function $e(e,n,t',
  'function R(e,n){',
  'function j(){',
  'function xe(){',
  'xe=function',
  'function Bn(e,n){',
  'Bn=function',
  'jn=',
  'function jn(e,n){',
  'le=b()==="windows"',
  'le=de',
  'var le=de',
]) {
  const hits = allHits(n).filter(i => i > 210480000 && i < 210580000)
  console.log(n, hits.slice(0, 6))
  for (const i of hits.slice(0, 2)) console.log('  ', ascii(i - 40, i + 180))
}

console.log('\n==== Fe usage near V / consts ====')
for (const n of [',[...Fe,', 'Fe,...n]', 'Fe,...$r', 'let Fe=', ',Fe,', 'Fe=[]']) {
  const hits = allHits(n).filter(i => i > 210530000 && i < 210570000)
  console.log(n, hits)
  for (const i of hits.slice(0, 2)) console.log('  ', ascii(i - 50, i + 80))
}

console.log('\n==== TCt K4n neighborhood ====')
console.log(ascii(215258900, 215259400))

console.log('\n==== Hu import ====')
console.log(ascii(212821050, 212821250))
