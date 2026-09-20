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

const base = 'docs/upstream-extraction/v2.1.247/snippets/'
const LO = 210500000
const HI = 210580000

function report(needle, lo = LO, hi = HI) {
  const hits = allHits(needle).filter(i => i > lo && i < hi)
  const all = allHits(needle)
  console.log('\n====', JSON.stringify(needle), 'win', hits, 'nAll', all.length)
  for (const i of (hits.length ? hits : all.slice(0, 2)).slice(0, 4)) {
    console.log(' ', i, ascii(i - 30, i + 240))
  }
  return hits
}

// restore case-collided gold
const qn = 210558263
writeFileSync(base + 'gold-forged-qn-reach.txt', extractFrom(qn, 400))
const Be = 210558204
writeFileSync(base + 'gold-forged-Be-bound.txt', extractFrom(Be, 200))

const QnHits = allHits('function Qn(e){').filter(i => i > LO && i < HI)
console.log('Qn', QnHits)
if (QnHits[0] !== undefined) {
  writeFileSync(base + 'gold-forged-Qn.txt', extractFrom(QnHits[0], 200))
}

const aliasBe = buf.indexOf(
  Buffer.from(
    'function be(e){let t=W();return(t==="windows"||t==="wsl")&&e.replaceAll',
  ),
)
console.log('alias be', aliasBe)
if (aliasBe >= 0) {
  writeFileSync(base + 'gold-forged-be.txt', extractFrom(aliasBe, 800))
}

const includeBe = allHits('async function be(e,n,t){').filter(
  i => i > LO && i < HI,
)
console.log('include be', includeBe)

console.log('\n==== pe callees / V deps ====')
for (const n of [
  'function Vn(',
  'function Vn(){',
  'function Pr(',
  'function Pr(e,n){',
  'function jn(',
  'function jn(e,n){',
  'kr=[',
  'var kr=',
  'kr=["',
  'function T(e,n){',
  'function J(e,n=[],t=0){',
  'function J(e){',
  'le=',
  'var le=',
  'function Bn(',
  'function Bn(e,n){',
  'function Gr(',
  'function Gr(e){',
  'function xe(',
  'function xe(){',
  'function Ce(',
  'function Ce(e,n,t',
  'function cn(',
  'function cn(e){',
  'function Ie(){',
  'function pn(){',
  'function j(){',
  'function R(e,n){',
  'function $e(',
  'function $e(e,n){',
  'xn=new Map',
  'var xn=',
  'Fe=[',
  'var Fe=',
  'Fe=["',
  'Tr="',
  'function Tr(',
]) {
  report(n)
}

console.log('\n==== module consts neighborhood 210563000 ====')
console.log(ascii(210563400, 210565200))

console.log('\n==== before pe 210556800 ====')
console.log(ascii(210556800, 210559400))

console.log('\n==== _583 imports around V ====')
console.log(ascii(210500000, 210501400))
