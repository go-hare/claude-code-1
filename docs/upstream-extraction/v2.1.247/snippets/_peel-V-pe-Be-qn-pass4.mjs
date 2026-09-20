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

function extractFrom(offset, max = 4000) {
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

console.log('==== _752 export z3c Q3c C3c ====')
for (const n of [
  ' as z3c}',
  ' as z3c,',
  ' as Q3c}',
  ' as Q3c,',
  ' as C3c}',
  ' as C3c,',
  ' as y5c}',
  ' as y5c,',
  ' as Qfd}',
  ' as Qfd,',
  ' as WJc}',
  ' as WJc,',
  ' as PYb}',
  ' as PYb,',
  ' as zBc}',
  ' as zBc,',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 4))
  for (const i of hits.slice(0, 1)) console.log('  ', ascii(i - 200, i + 80))
}

console.log('\n==== _752 module around no-optional-locks git ====')
for (const n of [
  '--no-optional-locks',
  'function xe(){',
  'xe=memoize',
  'whichSync("git")',
  'which("git")',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
}

console.log('\n==== cn + pt + Q + wt ====')
console.log(ascii(210532900, 210533400))

console.log('\n==== full Pr ====')
console.log(extractFrom(210558974, 800))

console.log('\n==== full Vn ====')
console.log(extractFrom(210557990, 400))

console.log('\n==== full Gr ====')
console.log(extractFrom(210563156, 280))

console.log('\n==== full cn ====')
console.log(extractFrom(210533172, 200))
