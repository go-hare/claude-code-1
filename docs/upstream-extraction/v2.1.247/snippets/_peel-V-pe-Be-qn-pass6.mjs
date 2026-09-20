import { readFileSync, writeFileSync } from 'fs'

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

function extractFrom(offset, max = 6000) {
  let i = offset
  let depth = 0
  let seen = false
  while (i < offset + max && i < buf.length) {
    if (buf[i] === 123) {
      depth++
      seen = true
    } else if (buf[i] === 125) {
      depth--
      if (seen && depth === 0) return ascii(offset, i + 1)
    }
    i++
  }
  return ascii(offset, Math.min(offset + max, buf.length))
}

const base = 'docs/upstream-extraction/v2.1.247/snippets/'

console.log('==== ji + _ Gt xn Rn init ====')
console.log(ascii(208233647, 208238400))

console.log('\n==== _= / Gt= / xn= / Rn= in _752 208220-208240 ====')
for (const n of [
  '_=[',
  'var _=',
  '_=["',
  'Gt=[',
  'Gt=["',
  'xn=new Set',
  'xn=new',
  'Rn=/',
  'Rn=new',
]) {
  const hits = allHits(n).filter(i => i > 208220000 && i < 208265000)
  console.log(n, hits.slice(0, 6))
  for (const i of hits.slice(0, 2)) console.log('  ', ascii(i - 20, i + 260))
}

console.log('\n==== $e ni near 207200-207225 ====')
console.log(ascii(207218000, 207221000))

console.log('\n==== search function ni( before Qfd ====')
for (const n of ['function ni(', 'var ni=', 'ni=(e,n)', 'function z(e,n){']) {
  const hits = allHits(n).filter(i => i > 207190000 && i < 207221000)
  console.log(n, hits)
  for (const i of hits.slice(0, 2)) console.log('  ', ascii(i, i + 280))
}

console.log('\n==== Rf before WJc 207321636 ====')
console.log(ascii(207318000, 207321700))

console.log('\n==== which PATH $e usage in Pr ====')
for (const n of [
  'function z(e,n){let',
  'whichFile',
  'Bun.which',
]) {
  const hits = allHits(n).filter(i => i > 207190000 && i < 207230000)
  console.log(n, hits.slice(0, 4))
}

console.log('\n==== R y zBc env get ====')
for (const n of ['function y(e,n){', 'function y(e,t){']) {
  const hits = allHits(n).filter(i => i > 207500000 && i < 207540000)
  console.log(n, hits)
  for (const i of hits.slice(0, 2)) console.log('  ', extractFrom(i, 300))
}
