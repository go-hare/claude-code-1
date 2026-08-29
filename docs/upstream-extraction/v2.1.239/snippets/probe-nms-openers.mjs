/**
 * Probe official 239 SEA for NMs opener call sites: Gm(<Spec>, …)
 * Invent-ban: dump hits only; do not invent migrations from Qg registry alone.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe =
  process.env.CLAUDE_SEA_239 ||
  join(process.env.TEMP || '', 'official-239', 'package', 'claude.exe')

const text = readFileSync(exe).toString('latin1')
console.log(`SEA ${exe} bytes=${text.length}`)

/** densable jsu kind symbols from gold-jsu-kinds.txt */
const KINDS = [
  ['$ne', 'refusal_fallback_prompt'],
  ['tbt', 'fable_overage_consent_prompt'],
  ['Gbt', 'mcp_url_elicitation'],
  ['DIi', 'computer_use_approval'],
  ['_Bi', 'it2_setup'],
  ['Dot', 'goal_proposal'],
  ['AEo', 'auto_mode_setup_review'],
  ['TEo', 'auto_mode_flagged_allow'],
  ['Wxt', 'cost_threshold'],
  ['Gxt', 'resume_return'],
  ['GSn', 'managed_settings_security'],
  ['FRr', 'sandbox_network_access'],
  ['qSn', 'auto_default_nudge'],
  ['UOo', 'peer_inbound_approval'],
  ['jOo', 'chrome_install_setup'],
  ['zOo', 'chrome_install_upsell'],
  ['CHr', 'ide_onboarding'],
]

function count(re) {
  return [...text.matchAll(re)].length
}

function dumpAround(needle, before = 80, after = 400, max = 3) {
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

const lines = []
function log(s) {
  console.log(s)
  lines.push(s)
}

log('## Qg registry presence')
for (const [sym, kind] of KINDS) {
  const qg = text.indexOf(`Qg({kind:"${kind}"`)
  log(`${kind}\tsym=${sym}\tQg@${qg}`)
}

log('\n## Gm(<sym> opener patterns')
for (const [sym, kind] of KINDS) {
  // Gm(Wxt, …) / Gm(qSn,{ / e(Wxt, / requestDialog style
  const patterns = [
    [`Gm(${sym},`, new RegExp(`Gm\\(${sym},`, 'g')],
    [`Gm(${sym})`, new RegExp(`Gm\\(${sym}\\)`, 'g')],
    // wrappers seen for cost: oXg(Gm,Q) — search kind string near Gm
  ]
  for (const [label, re] of patterns) {
    const c = count(re)
    if (c > 0) {
      log(`HIT ${kind} ${label} count=${c}`)
      for (const h of dumpAround(label, 100, 500, 2)) {
        log(`  @${h.at}: ${h.snip}`)
      }
    }
  }
}

// known wrappers
log('\n## known opener wrappers')
for (const name of [
  'function oXg(',
  'function LZh(',
  'function sXg(',
  'function doo(',
  'oXg(Gm,',
  'LZh(',
  'sXg(Gm)',
  'Gm(qSn,',
  'Gm(Wxt,',
  'Gm(GSn,',
  'Gm(CHr,',
  'Gm(Gxt,',
  'Gm(FRr,',
  'Gm(_Bi,',
  'Gm(DIi,',
  'Gm(Gbt,',
  'Gm(Dot,',
  'Gm(jOo,',
  'Gm(zOo,',
  'Gm(UOo,',
  'Gm(AEo,',
  'Gm(TEo,',
]) {
  const c = count(
    new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
  )
  log(`count ${name}: ${c}`)
  if (c > 0 && c < 20) {
    for (const h of dumpAround(name, 60, 350, 2)) {
      log(`  @${h.at}: ${h.snip}`)
    }
  }
}

// focused mfn / _Zt strings still present?
log('\n## focused dialog string counts')
for (const s of [
  'ide-onboarding',
  'idle-return',
  'sandbox-permission',
  'elicitation',
  'cost',
  'auto-default-nudge',
  'managed-settings',
  'resume_return',
  'sandbox_network_access',
]) {
  log(`count "${s}": ${count(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))}`)
}

// Search: (<sym>,{ near request patterns with kind string
log('\n## kind-string near requestDialog / mailbox open')
for (const [, kind] of KINDS) {
  const needle = `kind:"${kind}"`
  const c = count(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
  log(`kind:"${kind}" total=${c}`)
}

const out = join(
  'docs/upstream-extraction/v2.1.239/snippets',
  'gold-nms-opener-probe.txt',
)
writeFileSync(out, lines.join('\n'))
console.log(`\nWrote ${out}`)
