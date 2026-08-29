import { readFileSync, writeFileSync } from 'node:fs'

const exe = process.env.TEMP + '\\official-239\\package\\claude.exe'
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

let report = ''
function dump(label, needle, before, after, max = 6) {
  report += `\n## ${label} count=${hits(needle).length}\n`
  let n = 0
  for (const k of hits(needle, 25)) {
    n++
    report += `--- ${k}\n`
    report +=
      scrub(buf.subarray(Math.max(0, k - before), k + after).toString('latin1')) +
      '\n\n'
    if (n >= max) break
  }
}

dump('GTl( call', 'GTl(', 150, 250)
dump('udsBlankMessageGate call', 'udsBlankMessageGate', 80, 200)
dump('R0m=', 'R0m=', 40, 400)
dump('QRw=', 'QRw=', 40, 400)
dump('eIw=', 'eIw=', 40, 400)
dump('k0m=', 'k0m=', 20, 200)
dump('u3i=', 'u3i=', 20, 300)
dump('function LPi', 'function LPi', 40, 250)
dump('JRw(', 'JRw(', 80, 200)
dump('handler_rewrite', 'handler_rewrite', 80, 250)
dump('empty_message', 'empty_message', 80, 200)
dump('function ZRw', 'function ZRw', 20, 200)

writeFileSync(new URL('./gold-gtl-239.txt', import.meta.url), report)
console.log(report.slice(0, 22000))
