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

const jesNeedles = [
  'Refusing to stash',
  'async function Jes',
  'function Jes(',
  'leaveOutUncommittedCredentialFiles:!0',
  'stash","create"',
  'Captured WIP as stash',
]

for (const n of jesNeedles) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.slice(0, 3)) console.log('  ', i, ascii(i, i + 100))
}

// Jes-like around 215260000
writeFileSync(`${outDir}/gold-20-jes-215260.txt`, ascii(215258000, 215266000))
console.log('\n==== jes window start ====')
console.log(ascii(215258000, 215259200))

// find function that contains leaveOut at 215264011
const around = 215264011
let fn = buf.lastIndexOf(Buffer.from('async function '), around)
console.log('\nasync function before eYn call', fn, ascii(fn, fn + 80))
writeFileSync(`${outDir}/gold-20-jes-fn.txt`, extractFrom(fn, 12000))

// eYn definition: search eYn=
for (const n of [
  'eYn=async',
  'async function eYn(',
  'eYn=function',
  ',eYn=',
  'let eYn=',
  'var eYn=',
]) {
  const hits = allHits(n)
  console.log(n, hits)
}

// unique string from eYn internals
for (const n of [
  'claude-seed-stage-',
  'could not compare the built tree with HEAD',
  'function _(e,t){return{kind:"failed"',
  'kind:"refused"',
]) {
  const hits = allHits(n).filter(i => i > 210700000 && i < 210750000)
  console.log('mod', n, hits)
}
