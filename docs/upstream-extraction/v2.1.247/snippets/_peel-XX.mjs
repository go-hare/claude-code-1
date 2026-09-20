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

// XFe at 214521211: function XFe(){return XX("marketplaces",Fs())}
// Find XX definition used by that call — nearby function XX
const xfe = 214521211
const before = asciiWindow(buf, xfe - 15000, xfe)
const xxDef = before.lastIndexOf('function XX(')
console.log('xx-before-xfe', xxDef, xxDef >= 0 ? before.slice(xxDef, xxDef + 400) : 'none')

for (const n of [
  'function XX(e,t){',
  'function XX(e){',
  'function XX(e,t,n){',
]) {
  const hits = findAll(n, 8)
  console.log(n, hits)
  for (const i of hits) {
    if (Math.abs(i - xfe) < 500000) {
      writeFileSync(
        `docs/upstream-extraction/v2.1.247/snippets/gold-dig-XX-${i}.txt`,
        `# ${n} @${i} dist=${i - xfe}\n\n${asciiWindow(buf, i, i + 900)}\n`,
      )
      console.log('  dump', i, asciiWindow(buf, i, i + 250))
    }
  }
}
