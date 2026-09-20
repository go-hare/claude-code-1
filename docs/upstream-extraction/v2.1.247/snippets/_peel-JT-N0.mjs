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

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

function findAllInRange(needle, start, end, limit = 40) {
  const n = Buffer.from(needle)
  const hits = []
  let from = start
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0 || i >= end) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

const bSt = 214555004
const header = Buffer.from('// @bun @bytecode')
let from = Math.max(0, bSt - 8_000_000)
let modStart = -1
while (from < bSt) {
  const i = buf.indexOf(header, from)
  if (i < 0 || i > bSt) break
  modStart = i
  from = i + 10
}
const nextHeader = buf.indexOf(header, modStart + 10)
const modEnd = nextHeader > 0 ? nextHeader : Math.min(buf.length, bSt + 2_000_000)
console.log('modStart', modStart, 'modEnd', modEnd, 'span', modEnd - modStart)

// Import block: first ~120k of the marketplace module (imports only).
const importHead = asciiWindow(buf, modStart, Math.min(modStart + 120000, modEnd))
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-mkt-imports.txt',
  `# marketplace-mod imports @${modStart}..${modStart + importHead.length}\n\n${importHead}\n`,
)

const aliases = ['ye', 'Ar', 'tI', 'JT', 'N0']
const importHits = {}
for (const a of aliases) {
  const re = new RegExp(
    `([A-Za-z0-9_$]+) as ${a}([,}])`,
    'g',
  )
  const hits = []
  for (const m of importHead.matchAll(re)) {
    const around = importHead.slice(
      Math.max(0, m.index - 80),
      m.index + m[0].length + 80,
    )
    const fromM = around.match(/from"(B:\/~BUN\/root\/_[0-9]+\.js)"/)
    hits.push({
      exportName: m[1],
      sep: m[2],
      around,
      chunk: fromM?.[1] ?? null,
    })
  }
  importHits[a] = hits
  console.log(
    'IMPORT',
    a,
    hits.length,
    hits.map((h) => `${h.exportName} <- ${h.chunk} :: ${h.around.replace(/\n/g, ' ').slice(0, 160)}`),
  )
}

// Local defs / assignments inside THIS module only (no other-chunk collisions).
const localNeedles = [
  'class ye ',
  'class ye{',
  'class ye extends',
  'ye=class',
  'var ye=',
  'function ye(',
  'function Ar(',
  'var Ar=',
  'Ar=function',
  'Ar=(',
  'class tI ',
  'class tI{',
  'class tI extends',
  'tI=class',
  'var tI=',
  'function tI(',
  'function JT(',
  'var JT=',
  'JT=function',
  'function N0(',
  'var N0=',
  'N0=function',
]
for (const n of localNeedles) {
  const hits = findAllInRange(n, modStart, modEnd, 8)
  console.log('LOCAL', JSON.stringify(n), hits)
  for (const i of hits) {
    console.log(' ', i, asciiWindow(buf, i, i + 220).replace(/\n/g, ' '))
  }
}

// Calls inside marketplace module
for (const n of [
  'instanceof tI',
  'throw Ar(',
  'new ye(',
  'JT("plugin marketplace remove"',
  'JT("plugin marketplace',
  'JT("plugin ',
  'N0(',
]) {
  const hits = findAllInRange(n, modStart, modEnd, 12)
  console.log('CALL', JSON.stringify(n), hits)
  for (const i of hits.slice(0, 6)) {
    console.log(' ', i, asciiWindow(buf, Math.max(modStart, i - 40), i + 160).replace(/\n/g, ' '))
  }
}

// Unique call-site dumps requested
const tiCall = buf.indexOf(Buffer.from('instanceof tI'), bSt)
if (tiCall >= 0 && tiCall < modEnd) dump('gold-dig-tI-call.txt', tiCall, 80, 200)

const arCall = buf.indexOf(Buffer.from('throw Ar(Error(`Marketplace \''), modStart)
if (arCall >= 0 && arCall < modEnd) dump('gold-dig-Ar-call.txt', arCall, 40, 220)

const jtCall = buf.indexOf(Buffer.from('JT("plugin marketplace remove"'), modStart)
if (jtCall >= 0 && jtCall < modEnd) dump('gold-dig-JT-call.txt', jtCall, 80, 200)
