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

dump('gold-dig-xSt-after.txt', 214529933, 20, 2500)

for (const n of [
  'function kB(e)',
  'function kB(e){',
  'kB=e=>',
  'function XLn(e)',
  'function XLn(e){',
  'scopeKind(XLn',
]) {
  const hits = findAll(n, 8)
  console.log(n, hits)
  for (const i of hits.slice(0, 3)) {
    console.log(' ', i, asciiWindow(buf, i, i + 220).replace(/\n/g, ' '))
  }
}

const kb = findAll('function kB(e){', 8)
for (const i of kb) dump(`gold-dig-kB-${i}.txt`, i, 20, 400)
