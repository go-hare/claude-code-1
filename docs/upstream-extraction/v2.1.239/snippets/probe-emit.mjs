import { readFileSync } from 'node:fs'

const exe = process.env.TEMP + '\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)
const scrub = s => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '.')

function hits(needle, max = 10) {
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

for (const [label, needle, b, a] of [
  ['s("uds"', 's("uds"', 400, 80],
  ['function Tso', 'function Tso', 40, 400],
  ['cross_session_send', 'cross_session_send', 80, 200],
  ['tengu_sendmessage', 'tengu_sendmessage', 40, 200],
  ['emitSend', 'handler_rewrite', 200, 80],
]) {
  console.log('\n####', label)
  for (const k of hits(needle, 3)) {
    console.log('---', k)
    console.log(scrub(buf.subarray(Math.max(0, k - b), k + a).toString('latin1')))
  }
}
