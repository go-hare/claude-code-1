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

// class Ue full
const ue = buf.indexOf(Buffer.from('class Ue{identities=new Map'))
console.log('class Ue', ue)
writeFileSync(`${outDir}/gold-11-Ue-ident.txt`, extractFrom(ue, 2500))
console.log(extractFrom(ue, 2500))

// _752 constants near ae
writeFileSync(`${outDir}/gold-11-ae-before.txt`, ascii(208248000, 208253000))
console.log('\n==== Fo Io Ir se J near 20825 ====')
for (const n of [
  'var Fo=',
  'Fo=',
  'Io=',
  'var Io=',
  'function se(',
  'function J(',
  'function rt(',
  'Ir=',
  'be=',
  'function F(',
]) {
  for (const i of allHits(n).filter(x => x > 208240000 && x < 208256000)) {
    console.log(n, i, ascii(i, i + 180))
  }
}

// wt binding
console.log('\n==== wt ====')
for (const n of ['wt=Gs', 'wt=le', 'var wt', 'wt=Ue', 'wt=new']) {
  for (const i of allHits(n).filter(x => x > 207790000 && x < 207815000)) {
    console.log(n, i, ascii(i, i + 120))
  }
}
