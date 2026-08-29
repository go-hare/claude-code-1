/**
 * Peel 239 callers for iXg(Gxt), chrome jOo/zOo, Dot, AEo/TEo, UOo, CHr/FRr/_Bi/DIi.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe = join(process.env.TEMP || '', 'official-239', 'package', 'claude.exe')
const text = readFileSync(exe).toString('latin1')
const lines = []
const log = s => {
  console.log(s)
  lines.push(s)
}

function dumpAll(needle, before = 150, after = 500, max = 10) {
  const hits = []
  let from = 0
  while (hits.length < max) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    hits.push({
      at: i,
      snip: text
        .slice(Math.max(0, i - before), i + after)
        .replace(/[^\x20-\x7e]/g, '.'),
    })
    from = i + Math.max(1, needle.length)
  }
  return hits
}

for (const n of [
  'iXg(',
  'iXg(Gm',
  'iXg(Dd',
  'await iXg(',
  'e(Gxt,',
  'e(CHr,',
  'e(FRr,',
  'e(_Bi,',
  'e(DIi,',
  'await e(Gxt',
  'await e(CHr',
  'await e(FRr',
  'await e(_Bi',
  'await e(DIi',
  'l(Dot,',
  'pendingGoalProposal',
  't(jOo,',
  't(zOo,',
  'n(UOo,',
  'o(AEo,',
  'o(TEo,',
  'hasIdeOnboardingDialogBeenShown',
  'IdeOnboardingDialog',
  'function _Zt(',
  'function mfn(',
]) {
  const hits = dumpAll(n, 100, 450, 5)
  log(`\n==== ${n} (${hits.length}) ====`)
  for (const h of hits) log(`@${h.at}: ${h.snip}`)
}

// sandbox: still Ym queue?
for (const n of [
  'Ym((',
  'sandbox-permission',
  'pendingSandboxR',
  'GP==="sandbox',
  '==="sandbox-permission"',
]) {
  const c = [...text.matchAll(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))]
    .length
  log(`count ${n}: ${c}`)
}

writeFileSync(
  'docs/upstream-extraction/v2.1.239/snippets/gold-nms-opener-probe3.txt',
  lines.join('\n'),
)
log('Wrote probe3')
