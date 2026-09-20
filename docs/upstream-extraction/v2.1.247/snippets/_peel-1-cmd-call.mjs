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

dump('send-feedback-desc-load', 'Send feedback to Anthropic or report a bug', 40, 2500)
dump('bug-desc-load', 'Report a bug or share your conversation', 40, 2500)
dump('name-share-cmd', 'name:"share"', 80, 400)
dump('Rs-as-call', 'export{sr as Rs}', 20, 80)
dump('import-Rs-chunk', 'from"B:/~BUN/root/_159.js"', 80, 200)
dump('function-ye-messages', 'function ye(m)', 20, 400)
dump('sCa-body', 'function sCa(', 20, 400)
dump('W-decrement', 'function W(){', 20, 200)
dump('Agr-call', 'decrementSessionDraftCount', 40, 80)

// search near 218629970 for load/call after command objects
const off = data.indexOf('name:"feedback",description:"Send feedback to Anthropic')
lines.push('### around-feedback-reg more')
lines.push(ascii(data.slice(off, off + 4000)))
lines.push('')

writeFileSync(`${OUT}/gold-1-cmd-call-247.txt`, lines.join('\n'), 'latin1')
console.log('done', off)
