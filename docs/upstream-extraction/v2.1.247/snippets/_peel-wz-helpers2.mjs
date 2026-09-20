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

function extractFrom(offset, max = 2500) {
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

const lo = 210360000
const hi = 210430000

function hitsIn(needle) {
  return allHits(needle).filter(i => i >= lo && i < hi)
}

console.log('=== sandbox-window hits ===')
for (const n of [
  'function Lm(e,t)',
  'function _Z(e,t)',
  'function Ki(e,t)',
  'function Vm(',
  'function Ji(',
  'function Qi(',
  'function wv(',
  'wv=',
  ',Vm=',
  'Vm=function',
  'function Vm',
  'import{',
]) {
  const hits = hitsIn(n)
  console.log(n, hits)
}

console.log('\n=== Lm body ===')
const lm = extractFrom(210370534, 1500)
console.log(lm)
writeFileSync(`${outDir}/gold-11-Lm-210370534.txt`, lm)

console.log('\n=== _Z body @210370570 ===')
const z1 = extractFrom(210370570, 2000)
console.log(z1)
writeFileSync(`${outDir}/gold-11-_Z-210370570.txt`, z1)

console.log('\n=== functions 210368000-210378800 ===')
const chunk = ascii(210368000, 210378800)
for (const m of chunk.matchAll(/function [A-Za-z_$][\w$]*\([^)]*\)\{/g)) {
  console.log(m.index + 210368000, m[0])
}

// WZ imports: look for bun import preamble before first function in this file
console.log('\n=== 2k before Lm ===')
writeFileSync(
  `${outDir}/gold-11-before-Lm.txt`,
  ascii(210368000, 210370534),
)

// wv assignment anywhere
console.log('\n=== wv= hits (first 20) ===')
for (const i of allHits('wv=').slice(0, 20)) {
  console.log(i, ascii(i - 20, i + 80))
}

console.log('\n=== function wv hits ===')
for (const i of allHits('function wv')) {
  console.log(i, ascii(i, i + 120))
}

// identity map: look for Map + ino
for (const n of [
  'ino,fd',
  '.ino',
  'identityRecord',
  'dirIdent',
  'fdIdent',
  'stagingIdent',
  'openFds',
]) {
  console.log(n, allHits(n).slice(0, 8))
}

// 246-style names still in 247
for (const n of ['function Lm(e,t){', 'function Ki(e,t){', 'function qi(e,t){']) {
  const hits = allHits(n)
  console.log(n, hits.length, hits.slice(0, 5))
  for (const i of hits.slice(0, 3)) console.log('  ', extractFrom(i, 600))
}
