/**
 * Peel densable dialog kind strings + Lno/X_w from official 239 SEA.
 */
import { readFileSync, writeFileSync } from 'fs'

const exe = process.env.SEA || `${process.env.TEMP}/official-239/package/claude.exe`
const buf = readFileSync(exe)
const text = buf.toString('latin1')

function findAll(needle) {
  const out = []
  let i = 0
  while (true) {
    const j = text.indexOf(needle, i)
    if (j < 0) break
    out.push(j)
    i = j + needle.length
  }
  return out
}

const kindHits = new Set()
// kind:"foo" patterns near dialog
for (const m of text.matchAll(/kind:"([a-z][a-z0-9_]{2,60})"/g)) {
  const k = m[1]
  if (
    k.includes('permission') ||
    k.includes('dialog') ||
    k.includes('managed') ||
    k.includes('sandbox') ||
    k.includes('elicitation') ||
    k.includes('goal') ||
    k.includes('plan') ||
    k.includes('chrome') ||
    k.includes('browser') ||
    k.includes('tmux') ||
    k.includes('session') ||
    k.includes('fable') ||
    k.includes('mcp') ||
    k.includes('auto_mode') ||
    k.includes('auto-mode') ||
    k.includes('review') ||
    k.includes('plugin') ||
    k.includes('install') ||
    k.includes('cost') ||
    k.includes('idle') ||
    k.includes('worker') ||
    k.includes('channel')
  ) {
    kindHits.add(k)
  }
}

console.log('=== candidate kinds ===')
console.log([...kindHits].sort().join('\n'))

// Exact notification strings from Usu
const needles = [
  'Claude Code wants to enter plan mode',
  'Claude Code needs your approval for the plan',
  'Session paused',
  'A message from another session needs your approval',
  'Claude wants to use your browser',
  'Setting up Claude in Chrome',
  'Auto-mode setup proposal is ready for review',
  'Auto-mode setup flagged some permission rules for review',
  'Claude proposed a session goal',
  'Claude needs your approval for a review artifact',
  'sandbox request',
  'goal proposal',
  'Managed settings require approval',
  'function Lno',
  'async function Lno',
  'Lno=',
  'X_w',
  'operationType',
  'file permission',
]

for (const n of needles) {
  const offs = findAll(n).slice(0, 3)
  console.log(`\n=== ${JSON.stringify(n)} count=${findAll(n).length} offs=${offs.join(',')} ===`)
  for (const o of offs) {
    const snip = text.slice(Math.max(0, o - 200), o + 400)
    // extract nearby kind:"
    const kinds = [...snip.matchAll(/kind:"([^"]+)"/g)].map(x => x[1])
    console.log('nearby kinds', kinds)
    console.log(snip.replace(/[^\x20-\x7e\n]/g, '.').slice(0, 500))
  }
}

// Search Lno more carefully
for (const n of ['function Lno(', 'Lno(e)', 'async function* Lno', 'function* Lno']) {
  console.log(n, findAll(n).slice(0, 5))
}

// permission_file related async
for (const n of [
  'permission_file',
  'permission_bash',
  'permission_prompt',
  'permission_skill',
  'permission_powershell',
  'permission_webfetch',
  'permission_ask_user_question',
  'permission_workflow',
  'permission_monitor',
  'mcp_elicitation',
  'sandbox_permission',
  'enter_plan_mode',
  'exit_plan_mode',
  'session_goal',
  'fable_overage',
  'chrome_setup',
  'computer_use',
  'tmux_setup',
  'cost_threshold',
  'idle_return',
  'plugin_trust',
  'auto_mode_setup',
]) {
  const c = findAll(`"${n}"`).length + findAll(`'${n}'`).length + findAll(`kind:"${n}"`).length
  if (c) console.log(`literal ${n}: ${c}`)
}
