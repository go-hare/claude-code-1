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

function extractFrom(offset, max = 8000) {
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

for (const n of [
  'as eYn}',
  'as eYn,',
  'as tYn}',
  'as tYn,',
  'eYn as',
  'tYn as',
]) {
  const hits = allHits(n)
  console.log(n, hits)
  for (const i of hits.slice(0, 5)) console.log('  ', i, ascii(i - 80, i + 40))
}

// hs @210729859 is likely eYn
console.log('\n==== hs head ====')
console.log(ascii(210729859, 210731000))
writeFileSync(`${outDir}/gold-forged-hs.txt`, extractFrom(210729859, 20000))

// find tYn body via import into TCt module
const tctImp = buf.lastIndexOf(Buffer.from('from"'), 215257791)
console.log('\nlast from before TCt', tctImp, ascii(tctImp - 400, tctImp + 40))

// search eYn in TCt import window 215200000-215257791
writeFileSync(`${outDir}/gold-20-TCt-imp.txt`, ascii(215240000, 215258000))
