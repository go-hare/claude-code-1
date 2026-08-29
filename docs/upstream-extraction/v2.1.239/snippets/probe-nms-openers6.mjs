/**
 * Extract printable JS windows around remaining NMs openers.
 * Filters to runs with high ASCII-letter density so SEA binary noise is dropped.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe =
  process.env.CLAUDE_SEA_239 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-239-pkg/package/claude.exe'
const buf = readFileSync(exe)
const text = buf.toString('latin1')
console.log(`SEA bytes=${buf.length}`)

function jsWindow(i, before, after) {
  const start = Math.max(0, i - before)
  const end = Math.min(text.length, i + after)
  let s = ''
  for (let k = start; k < end; k++) {
    const c = text.charCodeAt(k)
    if (c >= 0x20 && c <= 0x7e) s += text[k]
    else s += '\n'
  }
  // keep only lines that look like JS
  return s
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length >= 8 && /[A-Za-z]{3,}/.test(l) && /[{}();=,]/.test(l))
    .join('\n')
}

function dump(needle, before = 2500, after = 4500, max = 3) {
  const out = []
  let from = 0
  for (let n = 0; n < max; n++) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    out.push({ at: i, snip: jsWindow(i, before, after) })
    from = i + needle.length
  }
  return out
}

const needles = [
  'A goal proposal is already awaiting',
  'tengu_goal_proposed',
  'l(Dot,{condition:',
  'pendingGoalProposal',
  'n(UOo,',
  'behavior:"approve"',
  'kind:"peer_inbound_approval"',
  't(jOo,',
  't(zOo,',
  'keep_waiting',
  'dont_ask_again',
  'o(AEo,',
  'o(TEo,',
  '/auto-mode-setup',
  'IdleReturnDialog',
  'idle-return-hint',
  'tengu_willow_mode',
  'tengu_idle_return_action',
]

const lines = []
function log(s) {
  console.log(s.slice(0, 400))
  lines.push(s)
}

for (const needle of needles) {
  log(`\n==== ${needle} ====`)
  const hits = dump(needle)
  log(`hits=${hits.length}`)
  for (const h of hits) {
    log(`@${h.at}:\n${h.snip.slice(0, 6000)}\n---`)
  }
}

const out = join(
  'docs/upstream-extraction/v2.1.239/snippets',
  'gold-nms-opener-probe6.txt',
)
writeFileSync(out, lines.join('\n'))
console.log(`Wrote ${out}`)
