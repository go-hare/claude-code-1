import { readFileSync } from 'node:fs'
const exe = process.env.TEMP + '\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)
const scrub = s => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '.')
function hits(n) {
  const nb = Buffer.from(n)
  const out = []
  let i = 0
  for (;;) {
    const k = buf.indexOf(nb, i)
    if (k === -1) break
    out.push(k)
    i = k + 1
    if (out.length >= 8) break
  }
  return out
}
for (const n of ['function ptn', 'ptn({route', 'tengu_cross_session', 'cross_session_message']) {
  console.log('\n##', n, hits(n).length)
  for (const k of hits(n).slice(0, 2)) {
    console.log('---', k)
    console.log(scrub(buf.subarray(Math.max(0, k - 80), k + 500).toString('latin1')))
  }
}
