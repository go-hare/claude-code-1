import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

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

function findAll(needle, limit = 16) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

for (const n of [
  'function kB(',
  'kB=function',
  'function kB',
  'async function m0n(',
  'function m0n(',
  'QLn().extend',
  'k.dev===T.dev',
  'class tI',
  'tI=class',
]) {
  const hits = findAll(n, 10)
  console.log(n, hits.slice(0, 8))
  for (const i of hits.slice(0, 3)) {
    console.log(' ', i, asciiWindow(buf, Math.max(0, i - 20), i + 200).replace(/\n/g, ' '))
  }
}

// kB( used as call - find definition by walking imports near 2114
const kbCall = buf.indexOf(Buffer.from('return kB(s)?n():!1'))
console.log('xSt kB call', kbCall)
if (kbCall >= 0) dump('gold-dig-xSt-kB-call.txt', kbCall, 40, 80)

const m0n = findAll('async function m0n(', 4)
if (m0n[0] != null) dump('gold-dig-m0n.txt', m0n[0], 20, 800)
