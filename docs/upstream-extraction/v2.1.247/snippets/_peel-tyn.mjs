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

function extractFrom(offset, max = 6000) {
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

for (const n of [
  'async function tYn(',
  'function tYn(',
  'tYn=async',
  'await tYn(',
]) {
  const hits = allHits(n)
  console.log(n, hits)
  for (const i of hits.slice(0, 4)) console.log('  ', i, ascii(i, i + 160))
}

const tyn = buf.indexOf(Buffer.from('async function tYn('))
console.log('tYn start', tyn)
if (tyn > 0) {
  writeFileSync(`${outDir}/gold-forged-tYn.txt`, extractFrom(tyn, 8000))
  console.log(extractFrom(tyn, 2500))
}

const eyn = buf.indexOf(Buffer.from('async function eYn('))
console.log('eYn start', eyn)
if (eyn < 0) {
  // maybe assigned later in same module as nn
  for (const n of ['eYn=async function', 'async function eYn', 'function eYn(e,t']) {
    console.log(n, allHits(n))
  }
}

// seed builder that has leaveOut in _465
const seed = buf.lastIndexOf(Buffer.from('async function '), 210730159)
console.log('async fn before leaveOut 210730159', seed, ascii(seed, seed + 100))
writeFileSync(`${outDir}/gold-forged-eYn-fn.txt`, extractFrom(seed, 15000))
