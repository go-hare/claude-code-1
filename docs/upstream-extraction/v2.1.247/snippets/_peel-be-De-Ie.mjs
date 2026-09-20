import { readFileSync } from 'fs'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
function ascii(start, end) {
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
function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

// _583 imports for be, De, Ie, y
console.log(ascii(210500000, 210501200))

for (const n of [
  'async function be(',
  'function be(',
  'async function De(',
  'function De(',
  'function Ie(',
  'function y(',
  ' as be}',
  ' as De}',
  ' as Ie}',
]) {
  const hits = allHits(n).filter(i => i > 210480000 && i < 210570000)
  console.log(n, hits.slice(0, 4))
  for (const i of hits.slice(0, 1)) console.log(ascii(i - 40, i + 300))
}
