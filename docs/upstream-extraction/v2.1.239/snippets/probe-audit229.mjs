import { readFileSync, writeFileSync } from 'node:fs'

const exe =
  'C:\\Users\\Administrator\\AppData\\Local\\Temp\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)

const scrub = (s) => s.replace(/[^\x09\x0a\x20-\x7e]/g, '.')

function allHits(needle) {
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

const probes = [
  ['goal-checkin-env', 'CLAUDE_CODE_GOAL_CHECKIN_MINUTES', 420, 120],
  ['b8p-unconsented', 'remote managed settings not yet verified', 300, 100],
  ['oih-malformed', 'peer_message_status dropped', 400, 200],
  ['media-withhold-buffer', 'tengu_refusal_fallback_supersedes', 200, 1600],
]

let report = ''
for (const [name, needle, back, fwd] of probes) {
  const hits = allHits(needle)
  report += `\n### ${name}  needle=${JSON.stringify(needle)}  hits=${hits.length}\n`
  const shown = hits.slice(0, 3)
  for (const h of shown) {
    report += `--- offset=${h}\n`
    report += scrub(buf.subarray(h - back, h + fwd).toString('latin1')) + '\n'
  }
  if (!hits.length) report += '(no hits)\n'
}

writeFileSync(new URL('./gold-audit229-probe.txt', import.meta.url), report)
console.log(report.slice(0, 12000))
