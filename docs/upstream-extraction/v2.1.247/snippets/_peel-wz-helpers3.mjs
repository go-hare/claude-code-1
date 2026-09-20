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

const targets = {
  'gold-11-yZ.txt': 210370394,
  'gold-11-bZ.txt': 210370340,
  'gold-11-no.txt': 210370650,
  'gold-11-qs.txt': 210370791,
  'gold-11-uv.txt': 210374620,
  'gold-11-Zi.txt': 210378069,
  'gold-11-Um.txt': 210378136,
  'gold-11-IZ-sbx.txt': 210373468,
  'gold-11-Wne.txt': 210374753,
  'gold-11-Js.txt': 210370182,
}

for (const [name, off] of Object.entries(targets)) {
  const body = extractFrom(off, 3500)
  writeFileSync(`${outDir}/${name}`, `# offset=${off}\n\n${body}\n`)
  console.log('===', name, off, 'len', body.length)
  console.log(body.slice(0, 500))
  console.log()
}

console.log('=== imports 210360470-210370180 ===')
const imp = ascii(210360400, 210370180)
writeFileSync(`${outDir}/gold-11-sbx-imports.txt`, imp)
for (const m of imp.matchAll(/import\{[^}]+\}from"[^"]+"/g)) {
  console.log(m[0].slice(0, 200))
}

console.log('\n=== WZ import names Vm/Ji/Qi in preamble ===')
for (const n of ['as Vm', 'as Ji', 'as Qi', 'as wv', 'Vm as', 'Ji as', 'Qi as']) {
  const i = imp.indexOf(n)
  console.log(n, i)
}

// search whole file for "as Vm}" or ",Vm," in import near 2103
const win = ascii(210360000, 210380000)
for (const n of ['as Vm}', ',Vm}', '{Vm as', 'as Ji}', 'as Qi}', 'as wv}', ',wv}', 'wv as']) {
  let from = 0
  let c = 0
  while (c < 5) {
    const i = win.indexOf(n, from)
    if (i < 0) break
    console.log('win', n, 210360000 + i, win.slice(Math.max(0, i - 80), i + 40))
    from = i + n.length
    c++
  }
}
