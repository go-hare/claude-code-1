import { readFileSync, writeFileSync } from 'node:fs'

const exe =
  'C:\\Users\\Administrator\\AppData\\Local\\Temp\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)
const scrub = (s) => s.replace(/[^\x09\x0a\x20-\x7e]/g, '.')

function hits(needle) {
  const nb = Buffer.from(needle)
  const out = []
  let i = 0
  for (;;) {
    const k = buf.indexOf(nb, i)
    if (k === -1) break
    out.push(k)
    i = k + 1
    if (out.length > 60) break
  }
  return out
}

let report = '## counts\n'
for (const c of [
  'expectPeerPid',
  'verifiedPeerPid',
  'hook_deferred_tool',
  'hook_stopped_continuation',
  'hold-receipt send failed to ',
]) {
  report += `${hits(c).length}\t${JSON.stringify(c)}\n`
}

report += '\n## hold-receipt send site (receipt dispatch)\n'
for (const k of hits('hold-receipt send failed to ')) {
  report += `--- offset=${k}\n${scrub(buf.subarray(k - 1800, k + 300).toString('latin1'))}\n\n`
}

report += '\n## hook_deferred_tool code context\n'
for (const k of hits('hook_deferred_tool')) {
  const w = scrub(buf.subarray(k - 700, k + 400).toString('latin1'))
  if (w.includes('===') || w.includes('type:')) report += `--- offset=${k}\n${w}\n\n`
}

writeFileSync(new URL('./gold-receipt-pid-239.txt', import.meta.url), report)
console.log(report.slice(0, 15000))
