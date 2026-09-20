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

function findAll(needle, limit = 12) {
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
  console.log('OK', name, i, 'len', after)
}

const lSt = 214542804
dump('gold-dig-LSt-full.txt', lSt, 40, 12000)

for (const n of [
  'async function $St(',
  'async function RBo(',
  'async function jFe(',
  'function jFe(',
  'function bB(',
  'async function Qx(',
  'function Qx(',
  'async function h0n(',
  'function CBo(',
  'function D$(',
  'async function Kl(',
  'function Ch(',
]) {
  const hits = findAll(n, 6)
  console.log(n, hits)
  for (const i of hits.slice(0, 2)) {
    console.log(' ', i, asciiWindow(buf, i, i + 160).replace(/\n/g, ' '))
  }
}

const rbo = findAll('async function RBo(', 3)
if (rbo[0] != null) dump('gold-dig-RBo-full.txt', rbo[0], 20, 3500)

const sst = findAll('async function $St(', 3)
if (sst[0] != null) dump('gold-dig-dollarSt-full.txt', sst[0], 20, 2500)

const qx = findAll('async function Qx(', 4)
for (const i of qx) {
  const win = asciiWindow(buf, i, i + 200)
  if (win.includes('storage') || win.includes('sparse') || win.includes('skipLfs') || win.includes('ref')) {
    dump(`gold-dig-Qx-${i}.txt`, i, 20, 4000)
  }
}
