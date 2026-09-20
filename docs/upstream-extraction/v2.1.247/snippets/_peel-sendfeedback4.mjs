import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function ascii(start, end) {
  let s = ''
  for (let j = Math.max(0, start); j < Math.min(buf.length, end); j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

const i = buf.indexOf(Buffer.from('var De=65536'))
let report = `De@${i}\n${ascii(i - 500, i + 120)}\n\n`
const needle = Buffer.from('function z(t,y)')
let z = buf.indexOf(needle)
if (z < 0) z = buf.indexOf(Buffer.from('function z(e,t){let'))
report += `z@${z}\n${ascii(z, z + 400)}\n\n`
const fNeedles = ['var F=1048576', 'var F=1e6', 'var F=524288', 'var F=2097152', 'var F=4194304', 'var F=8388608', 'F=1048576']
for (const n of fNeedles) {
  const h = buf.indexOf(Buffer.from(n))
  report += `${n} @${h}\n`
}
const zdt = buf.indexOf(Buffer.from('return zdt("feedbackDrafts")'))
report += `\nzdt call @${zdt}\n${ascii(zdt - 200, zdt + 80)}\n`
const ns = buf.indexOf(Buffer.from('function Ns(){if'), 216400000)
report += `\nNs@${ns}\n${ascii(ns, ns + 200)}\n`
const vgr = buf.indexOf(Buffer.from('vgr()'), 216529200)
report += `\nvgr near Ufs ${ascii(216528900, 216529400)}\n`

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-sendfeedback-peel4.txt',
  report,
)
console.log(report.slice(0, 2000))
