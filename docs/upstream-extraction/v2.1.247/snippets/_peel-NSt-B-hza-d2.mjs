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

function findAll(needle, limit = 20) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + 1
  }
  return hits
}

function dump(name, i, before, after) {
  const text = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${text}\n`,
  )
  console.log('OK', name, i, 'len', text.length)
}

const needles = [
  'async function NSt(',
  'function NSt(',
  'async function B$(',
  'function B$(',
  'async function hza(',
  'function hza(',
  'async function yza(',
  'function yza(',
  'async function d2(',
  'function d2(',
  'async function fza(',
  'function fza(',
  'async function mBo(',
  'function mBo(',
  'async function PSt(',
  'function ho(',
  'function ho(e)',
  'async function _za(',
  'async function bza(',
]

for (const n of needles) {
  const hits = findAll(n, 12)
  console.log('\n===', n, 'hits', hits.length, hits)
  for (const i of hits) {
    const win = asciiWindow(buf, i, i + 220)
    console.log(' ', i, win.slice(0, 200).replace(/\n/g, ' '))
  }
}

const uniqueDump = [
  ['async function NSt(', 'gold-dig-NSt-full.txt', 20, 4500],
  ['async function B$(', 'gold-dig-B$-full.txt', 20, 5000],
  ['async function hza(', 'gold-dig-hza-full.txt', 20, 4000],
  ['async function yza(', 'gold-dig-yza-full.txt', 20, 4000],
  ['async function d2(', 'gold-dig-d2-full.txt', 20, 2500],
  ['async function fza(', 'gold-dig-fza-full.txt', 20, 2500],
  ['async function mBo(', 'gold-dig-mBo-full.txt', 20, 1500],
  ['async function PSt(', 'gold-dig-PSt-body.txt', 20, 800],
  ['async function _za(', 'gold-dig-_za-full.txt', 20, 2500],
  ['async function bza(', 'gold-dig-bza-full.txt', 20, 2500],
]

for (const [needle, name, before, after] of uniqueDump) {
  const hits = findAll(needle, 8)
  if (hits.length === 1) {
    dump(name, hits[0], before, after)
  } else if (hits.length > 1) {
    console.log('MULTI', needle, hits)
    for (const [idx, i] of hits.entries()) {
      dump(name.replace('.txt', `-${idx}-${i}.txt`), i, before, after)
    }
  } else {
    console.log('MISS', needle)
  }
}

// ho = parsePluginIdentifier: look for name/marketplace split near NSt
const hoHits = findAll('function ho(e)', 12)
for (const i of hoHits) {
  const win = asciiWindow(buf, i, i + 400)
  if (
    win.includes('marketplace') ||
    win.includes('name:') ||
    win.includes('lastIndexOf') ||
    win.includes('@')
  ) {
    dump(`gold-dig-ho-${i}.txt`, i, 40, 800)
  } else {
    console.log('ho skip', i, win.slice(0, 120).replace(/\n/g, ' '))
  }
}

// also search parse-style: let n=e.lastIndexOf("@")
for (const n of [
  'function ho(e){let t=e.lastIndexOf("@")',
  'function ho(e){let n=e.lastIndexOf("@")',
  'function ho(e){let t=e.indexOf("@")',
  'function ho(e){let n=e.indexOf("@")',
  'function ho(e){let{name',
  'ho(e);if(!n||!r)',
]) {
  const hits = findAll(n, 8)
  console.log('parse-ho', n, hits)
  for (const i of hits) dump(`gold-dig-ho-parse-${i}.txt`, i, 20, 600)
}
