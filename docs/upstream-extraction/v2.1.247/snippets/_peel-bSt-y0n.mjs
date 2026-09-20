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
  console.log('OK', name, i)
}

for (const n of [
  'function bSt(',
  'function y0n(',
  'async function PSt(',
  'function PSt(',
  'async function LSt(',
  'function JT(',
  'Reserved marketplace name registered from untrusted source',
  'Marketplace has relative source path (legacy state)',
  'Failed to load marketplace from source',
]) {
  const hits = findAll(n, 6)
  console.log(n, hits)
  for (const i of hits.slice(0, 3)) {
    console.log(' ', i, asciiWindow(buf, i, i + 240).replace(/\n/g, ' '))
  }
}

const bSt = findAll('function bSt(', 4)
if (bSt[0] != null) dump('gold-dig-bSt-full.txt', bSt[0], 20, 2200)

const y0n = findAll('function y0n(', 4)
if (y0n[0] != null) dump('gold-dig-y0n-full.txt', y0n[0], 20, 600)

const pSt = findAll('async function PSt(', 4)
if (pSt[0] != null) dump('gold-dig-PSt-full.txt', pSt[0], 20, 1200)

const lSt = findAll('async function LSt(', 4)
if (lSt[0] != null) dump('gold-dig-LSt-sig.txt', lSt[0], 20, 800)

const jt = findAll('function JT(e,t)', 6)
for (const i of jt) {
  const win = asciiWindow(buf, i, i + 400)
  if (win.includes('plugin') || win.includes('slash') || win.includes('command')) {
    dump(`gold-dig-JT-${i}.txt`, i, 20, 800)
  }
}
