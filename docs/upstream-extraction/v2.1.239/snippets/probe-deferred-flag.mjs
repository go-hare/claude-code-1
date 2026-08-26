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
  'toolWasDeferred',
  'shouldPreventContinuation',
  'hook_stopped',
  'tool_deferred',
]) {
  report += `${hits(c).length}\t${JSON.stringify(c)}\n`
}

report += '\n## toolWasDeferred read sites\n'
for (const k of hits('toolWasDeferred')) {
  const w = scrub(buf.subarray(k - 500, k + 500).toString('latin1'))
  report += `--- offset=${k}\n${w}\n\n`
}

report += '\n## reason:"hook_stopped" context\n'
for (const k of hits('hook_stopped"')) {
  report += `--- offset=${k}\n${scrub(buf.subarray(k - 900, k + 500).toString('latin1'))}\n\n`
}

writeFileSync(new URL('./gold-deferred-flag-239.txt', import.meta.url), report)
console.log(report.slice(0, 15000))
