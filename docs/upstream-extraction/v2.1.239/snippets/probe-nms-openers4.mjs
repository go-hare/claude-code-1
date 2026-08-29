/**
 * Peel remaining NMs production openers from official 239 SEA.
 * Invent-ban: dump call-site windows only.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe = process.env.CLAUDE_SEA_239 || '/tmp/official-239-pkg/package/claude.exe'
const text = readFileSync(exe).toString('latin1')
console.log(`SEA ${exe} bytes=${text.length}`)

function dumpAround(needle, before = 400, after = 1800, max = 2) {
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
  'l(Dot,{condition:',
  'pendingGoalProposal',
  't(jOo,',
  't(zOo,',
  'n(UOo,',
  'o(AEo,',
  'o(TEo,',
  'sdu(CHr,',
  'requestDialog(FRr,',
  'requestDialog(_Bi,',
  'r(DIi,',
  'c(Gbt,',
  'await c(Gbt,',
  'kind:"goal_proposal"',
  'kind:"chrome_install_setup"',
  'kind:"chrome_install_upsell"',
  'kind:"peer_inbound_approval"',
  'kind:"auto_mode_setup_review"',
  'kind:"auto_mode_flagged_allow"',
  'kind:"ide_onboarding"',
  'kind:"it2_setup"',
  'kind:"computer_use_approval"',
  'IdleReturnDialog',
  'idle-return',
  'tengu_willow_mode',
  'function rXg(',
]

const lines = []
function log(s) {
  console.log(s)
  lines.push(s)
}

for (const needle of needles) {
  log(`\n==== ${needle} ====`)
  const hits = dumpAround(needle, 500, 2200, 3)
  log(`hits=${hits.length}`)
  for (const h of hits) {
    log(`@${h.at}:\n${h.snip}\n---`)
  }
}

const out = join(
  'docs/upstream-extraction/v2.1.239/snippets',
  'gold-nms-opener-probe4.txt',
)
writeFileSync(out, lines.join('\n'))
console.log(`Wrote ${out}`)
