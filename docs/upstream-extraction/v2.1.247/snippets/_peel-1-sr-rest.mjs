import { readFileSync, writeFileSync } from 'fs'
const SEA = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const OUT = 'D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.247/snippets'
const data = readFileSync(SEA, 'latin1')
const lines = []
function ascii(s) {
  return s.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
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

// helpers after sr end ~237004572
dump('after-sr-2k', 'function sr({messages:', 0, 12000)
dump('Write-new-feedback', 'Write new feedback', 400, 200)
dump('This-session-title', 'This session', 200, 80)
dump('isSelected-write', 'isSelected:se', 80, 80)
dump('function-We-any', 'function We(', 20, 500)
dump('Nfs-def', 'async function Nfs(', 20, 800)
dump('function-jt-submit', 'function jt({draft:', 20, 200)
dump('Gw-export', 'includeTranscript:', 120, 80)
dump('feedbackId-assign', 'feedbackId:', 80, 80)
dump('Co-near-config', '...Co()?[{id:"feedbackDrafts"', 400, 20)
dump('Ufs-near-config', 'Ufs()', 40, 40)
dump('render-sr', 't(sr,{', 80, 200)
dump('i-sr-jsx', 'i(sr,{', 80, 200)
dump('h-sr-create', 'createElement(sr', 40, 200)

writeFileSync(`${OUT}/gold-1-sr-rest-247.txt`, lines.join('\n'), 'latin1')
console.log('done')
