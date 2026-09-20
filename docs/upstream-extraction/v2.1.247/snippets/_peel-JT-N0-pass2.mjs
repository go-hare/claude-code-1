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

function importStmtAt(aliasNeedle) {
  const i = buf.indexOf(Buffer.from(aliasNeedle))
  if (i < 0) return { i: -1, stmt: null, chunk: null }
  const back = asciiWindow(buf, i - 2000, i + 800)
  const start = back.lastIndexOf('import{')
  const stmt = start >= 0 ? back.slice(start) : back
  const m = stmt.match(/^import\{[^}]*\}from"(B:\/~BUN\/root\/_[0-9]+\.js)"/)
  return { i, stmt: (m ? m[0] : stmt.slice(0, 500)), chunk: m?.[1] ?? null }
}

for (const n of [
  'Hyd as ye',
  'Iyd as Ar',
  'hfb as tI',
  'EOb as JT',
  'as N0,',
  'as N0}',
]) {
  const r = importStmtAt(n)
  console.log('STMT', n, r.i, r.chunk, r.stmt)
}

// Unique export-id defs (not short Windows names)
for (const n of [
  'class Hyd ',
  'class Hyd{',
  'class Hyd extends',
  'Hyd=class',
  'function Hyd(',
  'var Hyd=',
  'class Iyd ',
  'class Iyd{',
  'function Iyd(',
  'var Iyd=',
  'Iyd=class',
  'function hfb(',
  'class hfb ',
  'class hfb{',
  'class hfb extends',
  'hfb=class',
  'var hfb=',
  'function EOb(',
  'var EOb=',
  'EOb=function',
]) {
  const hits = findAll(n, 8)
  console.log('DEF', JSON.stringify(n), hits)
  for (const i of hits) {
    console.log(' ', asciiWindow(buf, i, i + 280).replace(/\n/g, ' '))
  }
}

// export bindings
for (const n of [' as Hyd}', ' as Hyd,', 'Hyd as ', ' as Iyd}', ' as Iyd,', ' as hfb}', ' as hfb,', ' as EOb}', ' as EOb,']) {
  const hits = findAll(n, 6)
  console.log('EXP', JSON.stringify(n), hits)
  for (const i of hits.slice(0, 3)) {
    console.log(' ', asciiWindow(buf, Math.max(0, i - 80), i + 120).replace(/\n/g, ' '))
  }
}

// CLI regex leftover / official
for (const n of [
  '^[\\w@./:-]+$',
  'claude ${',
  'claude "+',
  '`claude ${',
]) {
  const hits = findAll(n, 10)
  console.log('STR', JSON.stringify(n), hits)
  for (const i of hits.slice(0, 5)) {
    console.log(' ', i, asciiWindow(buf, i - 120, i + 180).replace(/\n/g, ' '))
  }
}

// Locate _844.js module start via filename comment or bun header near Hyd/Iyd
const hydImp = buf.indexOf(Buffer.from('Hyd as ye'))
console.log('Hyd as ye @', hydImp)
const chunk844 = buf.indexOf(Buffer.from('B:/~BUN/root/_844.js'))
console.log('first _844.js string', chunk844, asciiWindow(buf, chunk844 - 40, chunk844 + 80))
