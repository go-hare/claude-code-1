import { readFileSync, writeFileSync, existsSync } from 'fs'

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

const forged = allHits('why:"forged"')
const alias = allHits('why:"alias"')
const resurrected = allHits('why:"resurrected"')
console.log({ forged, alias, resurrected })

for (const i of forged) {
  console.log('\n==== why forged @', i, '====')
  console.log(ascii(i - 200, i + 180))
}

console.log('\n==== unique strings ====')
for (const n of [
  'why:"forged"',
  'why:"alias"',
  'why:"resurrected"',
  'why:"added"',
  'diff-tree',
  '--no-renames',
  'path-encoding',
  'filter|working-tree-encoding',
  'info","attributes"',
  'Ki=',
  'var Ki=',
  'function nn(',
  'function le(',
  'function be(',
  'function ee(',
]) {
  const hits = allHits(n)
  console.log(n, hits.length, hits.slice(0, 8))
}

// extract nn, le, be, ee, Ki
const nn = buf.indexOf(Buffer.from('async function nn(e,t,i,n){let r=await e(["diff-tree"'))
console.log('\nnn', nn)
writeFileSync(`${outDir}/gold-forged-nn.txt`, extractFrom(nn, 2500))

const le = buf.indexOf(Buffer.from('function le(e){return ee(Vi(e))&&!Ji(e)}'))
writeFileSync(`${outDir}/gold-forged-le.txt`, extractFrom(le, 800))

const be = buf.indexOf(
  Buffer.from('function be(e){let t=W();return(t==="windows"||t==="wsl")&&e.replaceAll'),
)
writeFileSync(`${outDir}/gold-forged-be.txt`, extractFrom(be, 800))

// Ki regex near be
const kiHits = allHits('Ki=').filter(i => i > 210700000 && i < 210760000)
console.log('Ki=', kiHits)
for (const i of kiHits) console.log(ascii(i, i + 200))

// callers of nn(
console.log('\n==== nn( call sites near module ====')
for (const n of ['await nn(', 'nn(e,', '=nn(', 'return nn(']) {
  const hits = allHits(n).filter(i => i > 210680000 && i < 210780000)
  console.log(n, hits)
  for (const i of hits) console.log('  ', i, ascii(i - 60, i + 80))
}

// export of this module
const bun = 210705712
writeFileSync(`${outDir}/gold-forged-mod-head.txt`, ascii(bun, bun + 2500))
console.log('\n==== module head ====')
console.log(ascii(bun, bun + 800))

// last export before next @bun
const nextBun = buf.indexOf(Buffer.from('// @bun'), bun + 20)
console.log('next @bun', nextBun, 'span', nextBun - bun)
writeFileSync(
  `${outDir}/gold-forged-mod-tail.txt`,
  ascii(nextBun - 1500, nextBun + 80),
)

// 246 compare if present
const p246 = [
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
  'C:/Users/ADMINI~1/AppData/Local/Temp/official-246/package/claude.exe',
]
let b246 = null
for (const p of p246) {
  if (existsSync(p)) {
    b246 = readFileSync(p)
    break
  }
}
if (b246) {
  const n = Buffer.from('why:"forged"')
  let c = 0
  let from = 0
  const hits = []
  while (from < b246.length) {
    const i = b246.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
    c++
  }
  console.log('246 why:forged hits', hits)
} else {
  console.log('246 exe not found')
}
