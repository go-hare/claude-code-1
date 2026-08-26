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

const counts = [
  'tengu_maple_sundial',
  'pickToCommit',
  'consentGated',
  'config_toggle',
  'hasClaudeMdExternalIncludesApproved',
  'showExternalIncludesDialog',
  'crossSessionInbound',
  'Messages from your other sessions',
  'Dialog expiry',
]

let report = '## presence counts\n'
for (const c of counts) report += `${hits(c).length}\t${JSON.stringify(c)}\n`

report += '\n## pickToCommit code context\n'
for (const k of hits('pickToCommit').slice(0, 4)) {
  report += `--- offset=${k}\n${scrub(buf.subarray(k - 1200, k + 900).toString('latin1'))}\n\n`
}

report += '\n## tengu_maple_sundial code context\n'
for (const k of hits('tengu_maple_sundial').slice(0, 4)) {
  report += `--- offset=${k}\n${scrub(buf.subarray(k - 600, k + 700).toString('latin1'))}\n\n`
}

writeFileSync(new URL('./gold-config-maple-239.txt', import.meta.url), report)
console.log(report.slice(0, 15000))
