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

const exp = 211619476
dump('gold-dig-kB-Yib-export.txt', exp, 80, 250)

const versionNeedle = Buffer.from('// Version: 2.1.247\nimport{')
const header = buf.lastIndexOf(versionNeedle, exp)
console.log('512 header', header, 'delta', exp - header)
if (header >= 0) {
  dump('gold-dig-kB-512-module.txt', header, 40, exp - header + 400)
}

// also dump a generous window before export
dump('gold-dig-kB-512-before-export.txt', exp, 8000, 400)

for (const n of [
  'function n(e){',
  'function n(e)',
  'n=e=>',
  'function n(',
  '["ELOOP","ENXIO","EISDIR"]',
  'ELOOP","ENXIO","EISDIR"',
]) {
  const hits = findAll(n, 12)
  console.log(JSON.stringify(n), hits)
  for (const i of hits.slice(0, 5)) {
    console.log(' ', i, 'd512', i - exp, asciiWindow(buf, Math.max(0, i - 40), i + 220).replace(/\n/g, ' '))
  }
}
