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

function findAll(needle, limit = 10) {
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
  'async function xSt(',
  'function xSt(',
  'function XLn(',
  'function kB(',
  'function jFe(',
  'async function jFe(',
  'function ASt(',
  'async function PBo(',
  'async function xBo(',
  'function tr(',
]) {
  const hits = findAll(n, 6)
  console.log(n, hits.filter(i => i > 210000000 && i < 216000000))
  for (const i of hits.filter(i => i > 214500000 && i < 214560000)) {
    console.log(' ', i, asciiWindow(buf, i, i + 280).replace(/\n/g, ' '))
  }
}

const xst = findAll('async function xSt(', 6)
for (const i of xst) dump(`gold-dig-xSt-${i}.txt`, i, 20, 1200)

const xln = findAll('function XLn(', 6)
for (const i of xln) {
  const win = asciiWindow(buf, i, i + 200)
  if (win.includes('marketplace') || win.includes('scope') || win.includes('plugin')) {
    dump(`gold-dig-XLn-${i}.txt`, i, 20, 400)
  }
}

const jfe = findAll('async function jFe(', 4).concat(findAll('function jFe(', 8))
for (const i of jfe) {
  const win = asciiWindow(buf, i, i + 160)
  if (win.includes('header') || win.includes('trusted') || win.includes('marketplace')) {
    dump(`gold-dig-jFe-${i}.txt`, i, 20, 800)
  }
}

dump('gold-dig-bB-214522002.txt', 214522002, 20, 900)
