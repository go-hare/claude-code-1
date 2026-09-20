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

const base = 'docs/upstream-extraction/v2.1.247/snippets/'

function dumpUnique(needle, out, max, lo = 210532000, hi = 210560000) {
  const hits = allHits(needle).filter(i => i > lo && i < hi)
  console.log(needle, hits)
  if (hits[0] !== undefined) writeFileSync(out, ascii(hits[0], hits[0] + max))
}

dumpUnique('async function Or(e){', base + 'gold-forged-Or.txt', 2200)
dumpUnique('async function nt(){', base + 'gold-forged-nt.txt', 400)
dumpUnique('async function tt(e,n){', base + 'gold-forged-tt.txt', 600)
dumpUnique('function Ue(e,n){', base + 'gold-forged-Ue.txt', 350)
dumpUnique('async function We(e){', base + 'gold-forged-We.txt', 400)
dumpUnique('function fe(e,n,t=', base + 'gold-forged-fe.txt', 200)
dumpUnique('function Fr(e,n){', base + 'gold-forged-Fr-ceiling.txt', 250)
dumpUnique('function Zn(e,n){', base + 'gold-forged-Zn.txt', 250)
dumpUnique('function et(e){', base + 'gold-forged-et.txt', 400)
dumpUnique('function Qn(e){', base + 'gold-forged-Qn.txt', 200)
dumpUnique('function Ie(){', base + 'gold-forged-Ie.txt', 400)
dumpUnique('async function Nr(e,n,t,r){', base + 'gold-forged-Nr.txt', 1200)

console.log('\n==== TCt J4n/pXo/tXo ====')
for (const n of [
  'function J4n(',
  'function pXo(',
  'tXo=180000',
  'function mXo',
  'refused_home_root',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 4))
  for (const i of hits.slice(0, 2)) console.log(ascii(i - 40, i + 220))
}
