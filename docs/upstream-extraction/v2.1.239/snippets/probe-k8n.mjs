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
    if (out.length > 40) break
  }
  return out
}

let report = ''

report += "## every hit of \"This plugin's headersHelper was not run\"\n"
for (const k of hits(`This plugin's headersHelper was not run`)) {
  report += `--- offset=${k}\n${scrub(buf.subarray(k - 700, k + 500).toString('latin1'))}\n\n`
}

report += '\n## K8n definition (via the lockdown tail)\n'
for (const k of hits('ask your admin to allow it or to declare the marketplace in managed settings')) {
  const w = scrub(buf.subarray(k - 1500, k + 300).toString('latin1'))
  if (w.includes('function') || w.includes('=>')) {
    report += `--- offset=${k}\n${w}\n\n`
  }
}

writeFileSync(new URL('./gold-k8n-239.txt', import.meta.url), report)
console.log(report.slice(0, 14000))
