import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

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

// k0 as Ptc
console.log('==== k0 ====')
const k0hits = allHits('function k0(')
console.log('function k0(', k0hits.slice(0, 8))
for (const i of k0hits.slice(0, 3)) {
  console.log(i, ascii(i, i + 400))
}

// _675 export k0
const k0exp = allHits('k0 as Ptc')
console.log('k0 as Ptc', k0exp)
for (const i of k0exp) console.log(ascii(i - 80, i + 20))

// H as Wzd in _845 — find function H(e,t) near that export module
console.log('\n==== H / Wzd ====')
const hAsWzd = allHits('H as Wzd')
console.log('H as Wzd', hAsWzd)
for (const i of hAsWzd) console.log(ascii(i - 200, i + 20))

// search truncate patterns near 206472546 (_845 export zone)
for (const n of [
  'function H(e,t){return e.length',
  'function H(e,t){if(t',
  'function H(e,t){return t',
  'function H(e,n){return e.length',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 5))
  for (const i of hits.slice(0, 2)) console.log(ascii(i, i + 180))
}

// _465 module start imports for on
console.log('\n==== _465 start ====')
console.log(ascii(210705712, 210706400))

// as on} near _465
const asOn = allHits(' as on}')
console.log('as on}', asOn.filter(i => i > 210700000 && i < 210730000))
for (const i of asOn.filter(i => i > 210700000 && i < 210730000)) {
  console.log(ascii(i - 80, i + 20))
}

// Eo as on?
for (const n of ['Eo as on', 'sn as on', '_o as on', 'GGb as on']) {
  console.log(n, allHits(n).slice(0, 5), allHits(n).slice(0, 2).map(i => ascii(i - 20, i + 20)))
}

// mt pluralize
console.log('\n==== mt ====')
for (const n of ['function mt(e,t,n)', 'function mt(e,t)', 'mt=function']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 5))
  for (const i of hits.slice(0, 2)) console.log(ascii(i, i + 200))
}

// X4n seed-admin
console.log('\n==== X4n / seed-admin ====')
for (const n of [
  'async function X4n',
  'function X4n',
  'seed-admin',
  '~/.claude/seed-admin',
]) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
}

// gXo / V.CLAUDE
console.log('\n==== gXo V ====')
console.log(ascii(215247900, 215248080))
const uc = allHits('CLAUDE_CODE_LEGACY_BUNDLE:()=>')
console.log('schema', uc)
for (const i of uc) console.log(ascii(i, i + 80))

// Qt stash author
console.log('\n==== Qt / GIT_AUTHOR ====')
for (const n of [
  'GIT_AUTHOR_NAME',
  'index on ${',
  'WIP on ${',
]) {
  const hits = allHits(n)
  console.log(n, hits.filter(i => i > 210720000 && i < 210750000).slice(0, 4))
}

// nn rest after gold-forged-Wi
console.log('\n==== nn after Wi ====')
console.log(ascii(210741800, 210743000))
