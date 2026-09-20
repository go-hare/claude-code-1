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

// function u near H @ ~206471800
console.log('==== u near H ====')
const hFn = buf.indexOf(Buffer.from('function H(t,n){if(t.length<=n)return t;let e=u(t,n);'))
console.log('H unique', hFn)
const uHits = allHits('function u(e,t)')
console.log(
  'function u(e,t)',
  uHits.filter(i => i > 206400000 && i < 206480000),
)
for (const n of ['function u(e,t){', 'function u(t,n){', 'function u(e,n){']) {
  const hits = allHits(n).filter(i => i > 206400000 && i < 206480000)
  console.log(n, hits)
  for (const i of hits) console.log(ascii(i, i + 350))
}

// walk back more for function u
console.log('\n==== module start before G/H ====')
console.log(ascii(206468000, 206470800))

// SXo imports
const sxo = buf.indexOf(Buffer.from('function SXo(e,t=!1)'))
console.log('\nSXo', sxo)
console.log(ascii(sxo - 400, sxo + 80))

// mt used as mt(e.length,"file") — find that string
const filePl = allHits('named like credentials')
console.log('cred str', filePl)

// import mt as 
for (const n of [' as mt}', ' as mt,', 'mt as mt', 'function mt(e,t,n){return e===1']) {
  console.log(n, allHits(n).slice(0, 8))
}

// pluralize unique
for (const n of [
  'function L(e,t,n=t){return',
  'function L(e,t,n){return(e===1||e==="1")',
  'n===void 0?t:n',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 4))
}

// X4n import
console.log('\n==== as X4n ====')
console.log(ascii(212821100, 212821280))

// who exports X4n
const x4nAs = allHits(' as X4n')
for (const i of x4nAs) console.log(ascii(i - 100, i + 30))

// Uc env getter — search boolean schema near CLAUDE_CODE_IS_COWORK
console.log('\n==== env schema around Uc ====')
// find uL cowork and nearby Uc definition that's boolean
const cowork = buf.indexOf(Buffer.from('CLAUDE_CODE_IS_COWORK:()=>'))
console.log(ascii(cowork - 200, cowork + 400))

// function that returns process.env boolean true only
for (const n of [
  'function Uc(){return',
  'Uc=()=>{return',
  'let Uc=()=>',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 5))
  for (const i of hits.slice(0, 2)) console.log(ascii(i, i + 200))
}

// Y hop in _465 — function Y(
const yClear = allHits('!=="clear"')
console.log('\nY clear', yClear.filter(i => i > 210700000 && i < 210750000))
for (const i of yClear.filter(i => i > 210700000 && i < 210750000).slice(0, 3)) {
  console.log(ascii(i - 80, i + 40))
}

// Y as import in _465
console.log('\n==== _465 more imports ====')
console.log(ascii(210705712, 210707200))
