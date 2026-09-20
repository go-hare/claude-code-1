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
const LO = 210532000
const HI = 210566000

function winHits(needle) {
  return allHits(needle).filter(i => i > LO && i < HI)
}

function dumpUnique(needle, out, max) {
  const hits = winHits(needle)
  console.log(needle, hits)
  if (hits.length === 1) {
    writeFileSync(out, extractFrom(hits[0], max))
    console.log('  LOCK', hits[0], '->', out)
  } else if (hits.length > 1) {
    console.log('  SKIP multi', hits.slice(0, 8))
  } else {
    console.log('  MISS in window')
  }
  return hits
}

const vHits = dumpUnique('function V(e,n,t){', base + 'gold-forged-V.txt', 1200)
const trHits = winHits('function tr(e){')
if (vHits[0] !== undefined && trHits[0] !== undefined) {
  writeFileSync(
    base + 'gold-forged-V.txt',
    extractFrom(vHits[0], 900) + extractFrom(trHits[0], 400),
  )
}

dumpUnique('function pe(e){', base + 'gold-forged-pe.txt', 800)
dumpUnique('function tr(e){', base + 'gold-forged-tr.txt', 400)
dumpUnique('function Zn(e,n){', base + 'gold-forged-Zn.txt', 250)
dumpUnique('function Ir(e){', base + 'gold-forged-Ir.txt', 400)
dumpUnique('function Pr(e,n){', base + 'gold-forged-Pr.txt', 500)
dumpUnique('function Vn(){', base + 'gold-forged-Vn.txt', 400)
dumpUnique('function et(e){', base + 'gold-forged-et.txt', 400)
dumpUnique('function Qn(e){', base + 'gold-forged-Qn.txt', 200)
dumpUnique('function J(e,n=[],t=0){', base + 'gold-forged-J-reach.txt', 400)
dumpUnique('function Sr(e){', base + 'gold-forged-Sr.txt', 250)
dumpUnique('function cn(e){', base + 'gold-forged-cn.txt', 200)
dumpUnique('function pn(){', base + 'gold-forged-pn.txt', 250)
dumpUnique('function T(e,n){', base + 'gold-forged-T.txt', 350)

writeFileSync(base + 'gold-forged-Be-bound.txt', extractFrom(210558204, 200))
writeFileSync(base + 'gold-forged-qn-reach.txt', extractFrom(210558263, 250))
writeFileSync(
  base + 'gold-forged-Gr.txt',
  'function Gr({gitDir:e,commonDir:n,workTree:t,adminDir:r}){return r===void 0?{GIT_DIR:e,GIT_COMMON_DIR:n,GIT_WORK_TREE:t}:{GIT_DIR:r,GIT_WORK_TREE:t,GIT_INDEX_FILE:d(r,"index")}}',
)
writeFileSync(
  base + 'gold-forged-Fe.txt',
  '_=Object.freeze(["-c","core.hooksPath=/dev/null","-c","core.fsmonitor="])',
)
writeFileSync(
  base + 'gold-forged-Bn-ji.txt',
  extractFrom(208233647, 500),
)

const aliasBe = buf.indexOf(
  Buffer.from(
    'function be(e){let t=W();return(t==="windows"||t==="wsl")&&e.replaceAll',
  ),
)
if (aliasBe >= 0) {
  writeFileSync(base + 'gold-forged-be.txt', extractFrom(aliasBe, 800))
}

console.log('\n==== imported / skip ====')
for (const n of [
  'function xe(){',
  'function Ce(',
  'function Bn(',
  'function $e(',
  'function j(){',
  'j()===void 0',
]) {
  console.log(n, 'win', winHits(n), 'all', allHits(n).slice(0, 4))
}

console.log('\n==== TCt K4n ====')
console.log(ascii(215258980, 215259200))

console.log('\n==== consts ====')
console.log(ascii(210563470, 210564820))
