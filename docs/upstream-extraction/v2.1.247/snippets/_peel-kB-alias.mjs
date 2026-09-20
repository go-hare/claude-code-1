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

function findAll(needle, limit = 40) {
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

const xSt = 214529933
const versionNeedle = Buffer.from('// Version: 2.1.247\nimport{')

// walk back from xSt to nearest module header
let header = -1
for (let from = xSt; from > xSt - 8_000_000; ) {
  const i = buf.lastIndexOf(versionNeedle, from)
  if (i < 0) break
  header = i
  console.log('header candidate', i, 'delta', xSt - i)
  // first (nearest) is the containing module
  break
}

if (header >= 0) {
  dump('gold-dig-kB-mod-header.txt', header, 80, 8000)
}

// all `as kB` / `kB as` near marketplace region
for (const n of [
  ' as kB}',
  ' as kB,',
  ',kB as ',
  '{kB as ',
  ' as kB from',
]) {
  const hits = findAll(n, 30)
  console.log(JSON.stringify(n), hits)
  for (const i of hits) {
    console.log(
      ' ',
      i,
      'nearXSt',
      i - xSt,
      asciiWindow(buf, Math.max(0, i - 80), i + 40),
    )
  }
}

// also search import lines containing as kB in a window before xSt
const windowStart = header >= 0 ? header : xSt - 200000
const slice = asciiWindow(buf, windowStart, xSt + 200)
const re = /[A-Za-z0-9_$]+ as kB\b|\bkB as [A-Za-z0-9_$]+/g
const ms = [...slice.matchAll(re)]
console.log('regex hits in module prefix', ms.map((m) => m[0] + '@' + (windowStart + m.index)))
