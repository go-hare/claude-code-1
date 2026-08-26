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

let report = '## counts\n'
for (const c of [
  'entry_helper_not_inlined',
  'entry_helper_deferred',
  'entry_helper_disabled_by_policy',
  'entry_helper_remote_policy_unconsented',
  'command_source_refused',
]) {
  report += `${hits(c).length}\t${JSON.stringify(c)}\n`
}

// q6a is the code -> "sad"|"bad" map; find it via a code literal followed by sad/bad
report += '\n## q6a map / class cwe windows\n'
for (const k of hits('entry_helper_not_inlined')) {
  const w = scrub(buf.subarray(k - 900, k + 900).toString('latin1'))
  if (w.includes('sad') || w.includes('bad') || w.includes('class')) {
    report += `--- offset=${k}\n${w}\n\n`
  }
}

writeFileSync(new URL('./gold-q6a-239.txt', import.meta.url), report)
console.log(report.slice(0, 14000))
