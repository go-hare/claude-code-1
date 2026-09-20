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

// Walk back from bSt looking for function JT / function Ar / class tI / var tI
const bSt = 214555004
dump('gold-dig-bSt-before.txt', bSt, 8000, 80)

for (const n of [
  'class tI extends',
  'class tI{',
  'tI=class',
  'var tI=',
  'function Ar(e,t){e.telemetry',
  'function Ar(e,t){return new',
  'Ar=(e,t)',
  'function JT(e,t){',
  'function JT(e,t,n){',
]) {
  const hits = findAll(n, 12)
  console.log(n, hits.filter(i => i > 210000000 && i < 216000000))
}

// Search plugin-bundle window 2144xxxxx-2146xxxxx for JT definition
const winStart = 214480000
const win = asciiWindow(buf, winStart, 214560000)
const jtIdx = win.lastIndexOf('function JT(')
const arIdx = win.lastIndexOf('function Ar(')
const tiIdx = win.lastIndexOf('class tI')
console.log('in window JT', jtIdx, 'Ar', arIdx, 'tI', tiIdx)
if (jtIdx >= 0) console.log(win.slice(jtIdx, jtIdx + 300))
if (arIdx >= 0) console.log(win.slice(arIdx, arIdx + 300))
if (tiIdx >= 0) console.log(win.slice(tiIdx, tiIdx + 300))

// also search slightly earlier for import aliases
for (const n of ['Ar as ', 'as Ar,', 'tI as ', 'as tI,', 'JT as ', 'as JT,']) {
  const hits = findAll(n, 20).filter(i => i > 214400000 && i < 214560000)
  console.log(n, hits)
  for (const i of hits) console.log(' ', asciiWindow(buf, i - 60, i + 80))
}
