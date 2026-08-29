/**
 * Peel remaining densable jsu kinds + tip call sites.
 */
import { readFileSync, writeFileSync } from 'fs'

const text = readFileSync(
  `${process.env.TEMP}/official-239/package/claude.exe`,
).toString('latin1')

function dump(label, needle, before = 100, after = 1200) {
  const i = text.indexOf(needle)
  console.log(`\n==== ${label} @ ${i} ====`)
  if (i < 0) return
  console.log(text.slice(i - before, i + after).replace(/[^\x20-\x7e]/g, '.'))
}

const kinds = [
  'it2_setup',
  'mcp_url_elicitation',
  'refusal_fallback_prompt',
  'goal_proposal',
  'auto_mode_setup_review',
  'auto_mode_flagged_allow',
  'auto_default_nudge',
  'review_artifact',
  'permission_workflow',
]

for (const k of kinds) {
  dump(`Qg ${k}`, `Qg({kind:"${k}"`, 0, 900)
}

// tip-side strings for host openers
for (const n of [
  'function o_y(', // fable mid-session from earlier gold
  'it2_setup',
  'auto_default_nudge',
  'goal_proposal',
  'Auto-mode setup proposal',
  'Setting up iTerm',
  'tmuxAvailable',
]) {
  const c = [...text.matchAll(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].length
  console.log(`count ${n}: ${c}`)
}

// Extract renderer stubs from gold-dialog-host-render for remaining
const host = readFileSync(
  'docs/upstream-extraction/v2.1.236/snippets/gold-dialog-host-render.txt',
  'utf8',
)
for (const name of ['l2A', 'c2A', 'u2A', 'd2A', 'p2A', 'g2A', 'f2A', 'Giu', 'o_y', 'Hnu', 'snu', 'anu', 'xou', '$nu', 'znu', 'Kmy']) {
  const i = host.indexOf(`${name}=`)
  console.log(`\n--- host ${name} @ ${i} ---`)
  if (i >= 0) console.log(host.slice(i, i + 350))
}

writeFileSync(
  'docs/upstream-extraction/v2.1.236/snippets/gold-jsu-remaining.txt',
  kinds
    .map(k => {
      const i = text.indexOf(`Qg({kind:"${k}"`)
      return i < 0
        ? `${k}\tMISSING`
        : `${k}\t${text.slice(i, i + 700).replace(/[^\x20-\x7e]/g, '.')}`
    })
    .join('\n\n'),
)
