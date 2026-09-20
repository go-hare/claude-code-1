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
  return s
}

const start844 = 206447190
const end844 = 206455647
const body844 = asciiWindow(buf, start844, end844)
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-Ar-844-full.txt',
  `# _844.js ${start844}..${end844} len=${end844 - start844}\n\n${body844}\n`,
)
console.log('844 dumped', body844.length)

// all z bindings in 844
for (const n of ['function z(', 'var z=', 'z=function', 'z=(', ',z=', ';z=', 'z=e=>', 'z=(e']) {
  let idx = 0
  while (true) {
    const i = body844.indexOf(n, idx)
    if (i < 0) break
    console.log('844', JSON.stringify(n), i, body844.slice(i, i + 200).replace(/\n/g, ' '))
    idx = i + n.length
  }
}

// last ce* before hfb export
const expHfb = 211612232
const startHfb = 211415952
const before = asciiWindow(buf, startHfb, expHfb)
const ceNeedles = ['ce=class', 'class ce ', 'class ce{', 'class ce extends', 'function ce(', 'var ce=', 'ce=function', 'ce=(']
for (const n of ceNeedles) {
  let last = -1
  let from = 0
  const hits = []
  while (true) {
    const i = before.indexOf(n, from)
    if (i < 0) break
    hits.push(startHfb + i)
    last = startHfb + i
    from = i + n.length
  }
  console.log('ce', JSON.stringify(n), 'count', hits.length, 'last', last)
  if (last >= 0) console.log(' ', asciiWindow(buf, last, last + 260).replace(/\n/g, ' '))
}

// Also dump last 4k before hfb export — init closures often sit there
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-tI-hfb-before-export.txt',
  `# last 6k before ce as hfb @${expHfb}\n\n${asciiWindow(buf, expHfb - 6000, expHfb + 80)}\n`,
)

// Find N0 truncate def: search function N0(e,t) in marketplace mod
const modStart = 212803258
const modEnd = 219715704
const n0two = Buffer.from('function N0(e,t)')
let from = modStart
let n = 0
while (n < 10) {
  const i = buf.indexOf(n0two, from)
  if (i < 0 || i >= modEnd) break
  console.log('N0(e,t) in mkt', i, asciiWindow(buf, i, i + 220).replace(/\n/g, ' '))
  from = i + 10
  n++
}

// walk back from 217553250 looking for N0=
const call = 217553250
const win = asciiWindow(buf, call - 50000, call)
for (const n2 of ['function N0(', 'var N0=', 'N0=function', 'N0=(', ',N0=', 'N0=e=>']) {
  const i = win.lastIndexOf(n2)
  console.log('N0-50k', JSON.stringify(n2), i === -1 ? -1 : call - 50000 + i)
  if (i >= 0) console.log(' ', win.slice(i, i + 220).replace(/\n/g, ' '))
}
