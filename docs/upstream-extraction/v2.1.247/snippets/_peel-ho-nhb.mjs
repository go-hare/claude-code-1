import { readFileSync } from 'fs'

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

function findAll(needle, limit = 15) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + 1
  }
  return hits
}

for (const n of [
  'nhb as ho',
  'ohb as ho',
  'phb as ho',
  'nhb as',
  'k as ho',
  'function $b(){',
  'function YF(',
  'function Po(){',
]) {
  const hits = findAll(n, 10)
  console.log('\n===', n, hits)
  for (const i of hits) {
    console.log(' ', i, asciiWindow(buf, i - 20, i + 140).replace(/\n/g, ' '))
  }
}
