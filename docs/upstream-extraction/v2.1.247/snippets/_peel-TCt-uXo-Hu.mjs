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

for (const n of [
  'async function uXo(',
  'async function tYn(',
  'function tYn(',
  'async function ys(',
  '["stash","create"]',
  '["bundle","create"',
  '["count-objects"',
]) {
  const hits = allHits(n)
  const win = hits.filter(i => i > 215220000 && i < 215280000)
  console.log(n, 'win', win, 'all', hits.slice(0, 4))
  for (const i of (win.length ? win : hits).slice(0, 1)) {
    console.log(ascii(i, i + 220))
  }
}

const uxo = allHits('async function uXo(')[0]
if (uxo) {
  writeFileSync(
    'docs/upstream-extraction/v2.1.247/snippets/gold-forged-TCt-uXo.txt',
    ascii(uxo, uxo + 3500),
  )
  console.log('uXo', uxo)
}
