import { readFileSync, writeFileSync } from 'fs'
const SEA = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const OUT = 'D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.247/snippets'
const data = readFileSync(SEA, 'latin1')
const lines = []
function ascii(s) {
  return s.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
function at(label, off, before, after) {
  lines.push(`### ${label} off=${off}`)
  lines.push(ascii(data.slice(Math.max(0, off - before), off + after)))
  lines.push('')
}
function dump(label, needle, before, after, from = 0) {
  const idx = data.indexOf(needle, from)
  lines.push(`### ${label} off=${idx}`)
  if (idx < 0) {
    lines.push('MISS')
    lines.push('')
    return idx
  }
  lines.push(ascii(data.slice(Math.max(0, idx - before), idx + after)))
  lines.push('')
  return idx
}

at('we-mid', 237004800, 0, 2300)
at('cmd-after-sr', 237007400, 0, 6000)

// all Co() near config
let from = 0
let n = 0
while (n < 20) {
  const idx = data.indexOf('function Co()', from)
  if (idx < 0) break
  lines.push(`### Co@${idx}`)
  lines.push(ascii(data.slice(idx, idx + 220)))
  lines.push('')
  from = idx + 1
  n++
}

dump('kGb-export', 'kGb as', 20, 80)
dump('function-kGb', 'function kGb(', 20, 300)
dump('Gw-ot-export', 'Gw as', 40, 80)
dump('Hw-as', 'Hw as', 40, 80)
dump('async-discard-via', 'async function', 20, 80)
dump('discardDraft', 'tengu_feedback_draft_discard', 200, 200)
dump('sCa-set', 'sCa as', 20, 40)
dump('function-sCa', 'function sCa(', 20, 250)
dump('Rs-call', 'Rs as T', 20, 40)
dump('create-T-feedback', 'T({messages:', 80, 250)
dump('t-T-messages', 't(T,{messages:', 80, 250)
dump('i-T-messages', 'i(T,{messages:', 80, 250)
dump('Ufs-config-gate', '...Ufs()?', 40, 80)
dump('aLt-config-gate', '...aLt()?', 40, 80)

writeFileSync(`${OUT}/gold-1-sr-cmd-247.txt`, lines.join('\n'), 'latin1')
console.log('done')
