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

// dump export neighborhoods
writeFileSync(
  `${outDir}/gold-11-export-Z2c.txt`,
  ascii(208262800, 208263400),
)
writeFileSync(
  `${outDir}/gold-11-export-Qxd.txt`,
  ascii(206915400, 206916000),
)
writeFileSync(
  `${outDir}/gold-11-export-had.txt`,
  ascii(207812200, 207812800),
)

console.log('==== _752 export neighborhood ====')
console.log(ascii(208262800, 208263400))

console.log('\n==== find function ne( near 20826 (path module) ====')
for (const i of allHits('function ne(').filter(x => x > 208200000 && x < 208270000)) {
  console.log(i, extractFrom(i, 2000).slice(0, 400))
}

console.log('\n==== function re( near 20826 ====')
for (const i of allHits('function re(').filter(x => x > 208200000 && x < 208270000)) {
  console.log(i, extractFrom(i, 2500).slice(0, 500))
}

console.log('\n==== function ko( near 20691 ====')
for (const i of allHits('function ko(').filter(x => x > 206850000 && x < 206930000)) {
  console.log(i, extractFrom(i, 2000).slice(0, 400))
}

console.log('\n==== function _r( near 20781 ====')
for (const i of allHits('function _r(').filter(x => x > 207750000 && x < 207830000)) {
  console.log(i, extractFrom(i, 2500).slice(0, 500))
}

console.log('\n==== // @bun before 208263 ====')
console.log(allHits('// @bun').filter(i => i > 208200000 && i < 208270000))
console.log(allHits('// @bun').filter(i => i > 206880000 && i < 206920000))
console.log(allHits('// @bun').filter(i => i > 207780000 && i < 207820000))
