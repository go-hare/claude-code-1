/**
 * Deeper 239 opener peel: wrappers + (<Sym>, call sites beyond Qg.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe = join(process.env.TEMP || '', 'official-239', 'package', 'claude.exe')
const text = readFileSync(exe).toString('latin1')

const SYMS = [
  'Wxt',
  'Gxt',
  'CHr',
  'FRr',
  'qSn',
  'GSn',
  '_Bi',
  'DIi',
  'Gbt',
  'Dot',
  'jOo',
  'zOo',
  'UOo',
  'AEo',
  'TEo',
  '$ne',
  'tbt',
]

function dumpAll(needle, before = 120, after = 280, max = 8) {
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
    from = i + needle.length
  }
  return hits
}

const lines = []
const log = s => {
  console.log(s)
  lines.push(s)
}

log('## Call-like (<Sym>,  — filter out Qg({kind')
for (const sym of SYMS) {
  const needle = `(${sym},`
  const raw = dumpAll(needle, 80, 200, 30)
  const filtered = raw.filter(
    h => !h.snip.includes(`Qg({kind:`) && !h.snip.includes(`kind:"`),
  )
  log(`\n### ${sym} raw=${raw.length} filtered=${filtered.length}`)
  for (const h of filtered.slice(0, 6)) {
    log(`@${h.at}: ${h.snip}`)
  }
}

log('\n## Wrappers after cost oXg / resume iXg')
for (const name of [
  'async function oXg(',
  'async function iXg(',
  'async function aXg(',
  'async function sXg(',
  'function sXg(',
  'async function nXg(',
  'async function rXg(',
  'CHr)',
  'Gxt)',
  'FRr)',
  '_Bi)',
  'DIi)',
  'jOo)',
  'zOo)',
  'Dot)',
  'UOo)',
]) {
  const hits = dumpAll(name, 40, 500, 3)
  log(`\n=== ${name} count~${hits.length} ===`)
  for (const h of hits) log(`@${h.at}: ${h.snip}`)
}

// How is ide onboarding opened? search dialog title / showIde
log('\n## ide / chrome / it2 / computer-use host strings')
for (const s of [
  'IdeOnboarding',
  'ide onboarding',
  'Install the Claude Code',
  'Claude in Chrome',
  'Setting up iTerm',
  'tmuxAvailable',
  'computer_use_approval',
  'Computer Use',
  'resume_return',
  'Welcome back',
  'sessionAgeMinutes',
  'sandbox_network_access',
  'Network access',
]) {
  const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  const c = [...text.matchAll(re)].length
  log(`count "${s}": ${c}`)
  if (c > 0 && c < 15) {
    for (const h of dumpAll(s, 60, 200, 2)) log(`  @${h.at}: ${h.snip}`)
  }
}

// _Zt / mfn focused return strings in 239
log('\n## focused helper return strings')
for (const s of [
  'return"message-selector"',
  'return"sandbox-permission"',
  'return"elicitation"',
  'return"idle-return"',
  'return"ide-onboarding"',
  'return"cost"',
  'return"tool-permission"',
  'return"managed-settings"',
  'return"worker-sandbox-permission"',
  'return"prompt"',
  'return"auto-default-nudge"',
]) {
  const c = [...text.matchAll(new RegExp(s, 'g'))].length
  log(`${s}: ${c}`)
}

writeFileSync(
  'docs/upstream-extraction/v2.1.239/snippets/gold-nms-opener-probe2.txt',
  lines.join('\n'),
)
log('\nWrote gold-nms-opener-probe2.txt')
