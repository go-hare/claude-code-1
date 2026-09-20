import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const base = 'docs/upstream-extraction/v2.1.247/snippets/'

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

for (const n of [
  'function Q3o(',
  'function J3o(',
  'async function We(',
  'function Ue(e,n){',
  'let y=await wXo',
  'y=await wXo',
  'if(h&&!await JS(h,u))',
  'partial_clone_old_git',
]) {
  const hits = allHits(n)
  const near = hits.filter(i => i > 210500000 && i < 215280000)
  console.log(n, 'all', hits.length, 'near', near.slice(0, 8))
  for (const i of (near.length ? near : hits).slice(0, 2)) {
    console.log(' @', i, ascii(Math.max(0, i - 80), i + 220))
  }
}

const q3 = allHits('function Q3o(').find(i => i > 215220000 && i < 215280000)
if (q3) {
  writeFileSync(base + 'gold-forged-TCt-Q3o.txt', extractFrom(q3, 400))
  console.log('wrote Q3o', q3)
}
const j3 = allHits('function J3o(').find(i => i > 210500000 && i < 215280000)
if (j3) {
  writeFileSync(base + 'gold-forged-TCt-J3o.txt', extractFrom(j3, 400))
  console.log('wrote J3o', j3)
}
