import { readFileSync } from 'node:fs'

const exe =
  process.env.TEMP + '\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)
const scrub = s => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '.')

function hits(needle, max = 20) {
  const nb = Buffer.from(needle)
  const out = []
  let i = 0
  for (;;) {
    const k = buf.indexOf(nb, i)
    if (k === -1) break
    out.push(k)
    i = k + 1
    if (out.length >= max) break
  }
  return out
}

for (const [label, needle, before, after] of [
  ['function Cs(', 'function Cs(', 40, 250],
  ['function rOu', 'function rOu', 40, 200],
  ['bMi(e)!==void 0', 'bMi(e)!==void 0', 200, 400],
]) {
  console.log('\n##', label)
  for (const k of hits(needle, 5)) {
    console.log('---', k)
    console.log(scrub(buf.subarray(Math.max(0, k - before), k + after).toString('latin1')))
  }
}
