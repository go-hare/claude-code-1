import { readFileSync } from 'fs'

const exe =
  'C:/Users/Administrator/AppData/Local/Temp/official-248/package/claude.exe'
const b = readFileSync(exe)

function asciiSlice(buf, start, end) {
  let s = ''
  for (let j = Math.max(0, start); j < Math.min(buf.length, end); j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

const pqt = 188016977
console.log('Pqt-win\n', asciiSlice(b, pqt - 200, pqt + 700))

function hits(n) {
  const needle = Buffer.from(n)
  const out = []
  let i = 0
  while (i < b.length && out.length < 6) {
    const k = b.indexOf(needle, i)
    if (k < 0) break
    out.push(k)
    i = k + needle.length
  }
  return out
}

for (const n of [
  'function $ee(',
  '$ee("restart")',
  'did not respond',
  'it may be stalled',
]) {
  const hs = hits(n)
  console.log('\n##', n, hs)
  for (const i of hs) console.log('@', i, asciiSlice(b, i - 60, i + 160))
}
