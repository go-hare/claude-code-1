import { readFileSync, writeFileSync } from 'fs'

const files = [
  'docs/upstream-extraction/v2.1.247/snippets/gold-20-jes-fn.txt',
  'docs/upstream-extraction/v2.1.247/snippets/gold-forged-TCt-bundle-tail.txt',
  'docs/upstream-extraction/v2.1.247/snippets/gold-20-TCt-imp.txt',
]
for (const f of files) {
  const t = readFileSync(f, 'utf8')
  for (const n of [
    'async function E4n',
    'function E4n',
    'await E4n(',
    'function $I(',
    'bp($l(e),200)',
  ]) {
    const i = t.indexOf(n)
    console.log(f.split(/[/\\]/).pop(), n, i)
    if (i >= 0) console.log(t.slice(i, i + 700))
  }
  console.log('=====')
}

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
function hits(needle) {
  const n = Buffer.from(needle)
  const out = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    out.push(i)
    from = i + n.length
  }
  return out
}
for (const n of [
  'async function E4n(',
  'function E4n(',
  'The bundle could not be read back',
  'bundle grew to ',
]) {
  const all = hits(n)
  console.log('SEA', n, all.slice(0, 5))
  for (const i of all.slice(0, 1)) {
    console.log(ascii(Math.max(0, i - 80), i + 600))
    writeFileSync(
      'docs/upstream-extraction/v2.1.247/snippets/gold-forged-TCt-E4n.txt',
      ascii(Math.max(0, i - 20), i + 800),
    )
  }
}
