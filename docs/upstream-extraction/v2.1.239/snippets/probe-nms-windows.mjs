import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe =
  process.env.CLAUDE_SEA_239 ||
  'C:/Users/Administrator/AppData/Local/Temp/official-239-pkg/package/claude.exe'
const text = readFileSync(exe).toString('latin1')

function asciiRun(i, before, after) {
  const start = Math.max(0, i - before)
  const end = Math.min(text.length, i + after)
  let s = ''
  for (let k = start; k < end; k++) {
    const c = text.charCodeAt(k)
    s += c >= 0x20 && c <= 0x7e ? text[k] : '\n'
  }
  return s.replace(/\n{2,}/g, '\n').trim()
}

const targets = [
  { name: 'goal-call', needle: 'async call({condition:e,ask_user:t},r){if(r.agentId)', after: 5000 },
  { name: 'l-Dot', needle: 'l(Dot,{condition:', after: 2500 },
  { name: 'n-UOo', needle: 'n(UOo,', after: 2500 },
  { name: 't-jOo', needle: 't(jOo,', after: 3500 },
  { name: 't-zOo', needle: 't(zOo,', after: 2500 },
  { name: 'o-AEo', needle: 'o(AEo,', after: 2500 },
  { name: 'o-TEo', needle: 'o(TEo,', after: 2500 },
  { name: 'Dot-Qg', needle: 'kind:"goal_proposal"', after: 800 },
  { name: 'UOo-Qg', needle: 'kind:"peer_inbound_approval"', after: 800 },
  { name: 'jOo-Qg', needle: 'kind:"chrome_install_setup"', after: 800 },
  { name: 'zOo-Qg', needle: 'kind:"chrome_install_upsell"', after: 800 },
  { name: 'idle-hint', needle: 'idle-return-hint', after: 1500 },
  { name: 'willow', needle: 'tengu_willow_mode', after: 1500 },
  { name: 'idle-action', needle: 'tengu_idle_return_action', after: 1500 },
]

const dir = 'docs/upstream-extraction/v2.1.239/snippets'
const index = []
for (const t of targets) {
  const i = text.indexOf(t.needle)
  if (i < 0) {
    index.push(`${t.name}: NOT FOUND`)
    continue
  }
  const body = asciiRun(i, 400, t.after)
  const file = join(dir, `gold-win-${t.name}.txt`)
  writeFileSync(file, `@${i}\n${body}`)
  index.push(`${t.name}: @${i} ${file} chars=${body.length}`)
}
writeFileSync(join(dir, 'gold-win-index.txt'), index.join('\n'))
console.log(index.join('\n'))
