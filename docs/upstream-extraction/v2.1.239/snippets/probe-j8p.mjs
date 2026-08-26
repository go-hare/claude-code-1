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

// 1) count-only: which candidate user-facing strings exist at all
const counts = [
  `This plugin's headersHelper was not run`,
  'disable marketplace-declared commands (disableCommandPluginSources / allowManagedHooksOnly)',
  'The plugin was not installed or updated and the command was not run',
  'ask your admin to allow it or to declare the marketplace in managed settings',
  'must inline its manifest so its capabilities can be reviewed before the command runs',
  'which only runs when you install or update it from its own details view',
]

let report = '## presence counts\n'
for (const c of counts) report += `${hits(c).length}\t${JSON.stringify(c)}\n`

// 2) code window around the strict:false authoring-error throw, which sits
//    inside J8p right after the policy-refusal branch.
report += '\n## J8p code windows\n'
for (const k of hits('must inline its manifest so its capabilities can be reviewed')) {
  const w = scrub(buf.subarray(k - 2000, k + 700).toString('latin1'))
  if (w.includes('function') || w.includes('=>') || w.includes('throw')) {
    report += `--- offset=${k}\n${w}\n\n`
  }
}

writeFileSync(new URL('./gold-j8p-239.txt', import.meta.url), report)
console.log(report.slice(0, 14000))
