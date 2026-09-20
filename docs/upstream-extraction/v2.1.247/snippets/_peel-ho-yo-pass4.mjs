import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function findAll(needle, limit = 8, from = 0, to = buf.length) {
  const n = Buffer.from(needle)
  const hits = []
  let i = from
  while (hits.length < limit) {
    const j = buf.indexOf(n, i)
    if (j < 0 || j > to) break
    hits.push(j)
    i = j + n.length
  }
  return hits
}

function extractFn(start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  if (i >= buf.length) return { start, end: start, text: '' }
  let depth = 0
  let inS = 0
  let esc = false
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inS) {
      if (esc) {
        esc = false
        continue
      }
      if (c === 92) {
        esc = true
        continue
      }
      if (c === inS) inS = 0
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inS = c
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        return { start, end: i + 1, text: asciiWindow(start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(start, start + 200) }
}

writeFileSync(
  `${outDir}/gold-ho-yo-Gzd-export.txt`,
  `# @206472402\n${asciiWindow(206472340, 206472480)}\n`,
)

const gzdAs = buf.indexOf(Buffer.from(' as Gzd,'), 206470000)
console.log('as Gzd @', gzdAs, asciiWindow(gzdAs - 80, gzdAs + 20))

// typical grapheme slice names before Gzd in that export list
const win = asciiWindow(206471800, 206472450)
console.log('EXPORT WIN', win)

for (const pat of [
  'function y(e,t){',
  'function l(e,t){',
  'function p(e,t){',
  'function M(e,t){',
]) {
  const hits = findAll(pat, 6, 206450000, 206472402)
  console.log(pat, hits)
  for (const i of hits) {
    const fn = extractFn(i)
    console.log(' ', i, fn.text.slice(0, 180))
  }
}
