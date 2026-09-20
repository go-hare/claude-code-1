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
  const text = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${text}\n`,
  )
  console.log('OK', name, i, 'len', text.length)
}

dump('gold-dig-tZ-full.txt', 214526295, 200, 2500)
dump('gold-dig-eZ-full.txt', 214553971, 400, 4500)

// U$ definition
function findAll(needle, limit = 8) {
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

for (const n of [
  'async function U$(',
  'function U$(',
  'U$=async',
  'async function U$(e)',
  'function U$(e)',
  'function U$(e,t)',
]) {
  const hits = findAll(n)
  console.log(n, hits)
}

// XFe / RSt / nme near eZ
for (const n of [
  'function XFe(',
  'async function XFe(',
  'function RSt(',
  'async function RSt(',
  'function nme(',
  'function Ne(){',
]) {
  const hits = findAll(n, 5)
  console.log(n, hits)
  if (hits[0] != null && Math.abs(hits[0] - 214553971) < 2_000_000) {
    dump(`gold-dig-${n.replace(/[^A-Za-z0-9]/g, '_')}.txt`, hits[0], 40, 800)
  }
}
