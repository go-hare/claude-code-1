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

function extractFrom(offset, max = 5000) {
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

function listFns(lo, hi, label) {
  console.log('\n====', label, lo, hi, '====')
  const chunk = ascii(lo, hi)
  for (const m of chunk.matchAll(/function [A-Za-z_$][\w$]*\([^)]*\)\{/g)) {
    const off = lo + m.index
    console.log(off, m[0], extractFrom(off, 800).slice(0, 160).replaceAll('\n', ' '))
  }
}

// _752 path module containing ne/re
listFns(208216739, 208263944, '_752')

// _841 containing ko
listFns(206902881, 206915982, '_841')

// _806 containing _r
listFns(207795831, 207812826, '_806')

writeFileSync(`${outDir}/gold-11-ne.txt`, extractFrom(208253323))
writeFileSync(`${outDir}/gold-11-re-xe.txt`, extractFrom(208254079))
writeFileSync(`${outDir}/gold-11-ko.txt`, extractFrom(206910537))
writeFileSync(`${outDir}/gold-11-_r.txt`, extractFrom(207801746))
