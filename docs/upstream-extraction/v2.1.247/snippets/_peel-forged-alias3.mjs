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

writeFileSync(
  `${outDir}/gold-forged-nn-call.txt`,
  ascii(210733450, 210733850),
)
writeFileSync(
  `${outDir}/gold-forged-Wi-nbhd.txt`,
  ascii(210736900, 210738200),
)
writeFileSync(
  `${outDir}/gold-forged-eYn.txt`,
  ascii(215263850, 215264450),
)
writeFileSync(
  `${outDir}/gold-forged-G3a-import.txt`,
  ascii(227364600, 227365200),
)
writeFileSync(
  `${outDir}/gold-forged-refuse.txt`,
  ascii(201698850, 201699050),
)

console.log('==== nn call ====')
console.log(ascii(210733450, 210733900))
console.log('\n==== Yi Wi ====')
console.log(ascii(210736980, 210738140))
console.log('\n==== eYn ====')
console.log(ascii(215263900, 215264400))
console.log('\n==== G3a import module ====')
console.log(ascii(227364500, 227365100))

// eYn / tYn defs
for (const n of ['async function eYn', 'function eYn', 'async function tYn']) {
  const hits = allHits(n)
  console.log(n, hits)
  for (const i of hits.slice(0, 3)) console.log('  ', i, ascii(i, i + 160))
}

// withholdFor
for (const n of ['withholdFor', 'alsoLeaveOut', 'uncommitted_credentials']) {
  const hits = allHits(n)
  console.log(n, hits.slice(0, 8))
}

// xIb export from _582
const xib = allHits('xIb as')
console.log('xIb as', xib.slice(0, 8))
for (const i of xib.slice(0, 4)) console.log('  ', i, ascii(i - 30, i + 40))

const exp = buf.indexOf(Buffer.from('ee as xIb'))
console.log('ee as xIb', exp, exp > 0 ? ascii(exp - 80, exp + 40) : '')
