/**
 * Peel remaining NMs opener windows (goal / chrome / auto_mode / peer / idle).
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe =
  process.env.CLAUDE_SEA_239 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-239-pkg/package/claude.exe'
const text = readFileSync(exe).toString('latin1')
console.log(`SEA ${exe} bytes=${text.length}`)

function dumpAround(needle, before = 800, after = 2800, max = 2) {
  const out = []
  let from = 0
  for (let n = 0; n < max; n++) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    out.push({
      at: i,
      snip: text
        .slice(Math.max(0, i - before), i + after)
        .replace(/[^\x20-\x7e]/g, '.'),
    })
    from = i + needle.length
  }
  return out
}

const needles = [
  'pendingGoalProposal',
  'l(Dot,{condition:',
  'kind:"goal_proposal"',
  'n(UOo,',
  'kind:"peer_inbound_approval"',
  't(jOo,',
  't(zOo,',
  'kind:"chrome_install_setup"',
  'kind:"chrome_install_upsell"',
  'o(AEo,',
  'o(TEo,',
  'kind:"auto_mode_setup_review"',
  'kind:"auto_mode_flagged_allow"',
  'IdleReturnDialog',
  'tengu_willow_mode',
  'idle-return-hint',
  'function rXg(',
]

const lines = []
function log(s) {
  console.log(s)
  lines.push(s)
}

for (const needle of needles) {
  log(`\n==== ${needle} ====`)
  const hits = dumpAround(needle, 700, 2600, 2)
  log(`hits=${hits.length}`)
  for (const h of hits) {
    log(`@${h.at}:\n${h.snip}\n---`)
  }
}

const out = join(
  'docs/upstream-extraction/v2.1.239/snippets',
  'gold-nms-opener-probe5.txt',
)
writeFileSync(out, lines.join('\n'))
console.log(`Wrote ${out}`)
