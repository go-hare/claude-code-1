import { readFileSync, writeFileSync } from 'fs'
const SEA = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const OUT = 'D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.247/snippets'
const data = readFileSync(SEA, 'latin1')
const lines = []
function ascii(s) {
  return s.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
function dump(label, needle, before, after) {
  const idx = data.indexOf(needle)
  lines.push(`### ${label} off=${idx}`)
  if (idx < 0) {
    lines.push('MISS')
    lines.push('')
    return
  }
  lines.push(ascii(data.slice(Math.max(0, idx - before), idx + after)))
  lines.push('')
}

dump('sr-helpers-before', 'function sr({messages:', 3500, 80)
dump('write-new-row', 'function We({isSelected', 40, 400)
dump('list-section', 'function et({title:', 40, 800)
dump('field-editor', 'function we({label:', 40, 900)
dump('focus-tick', 'function T({isFocused', 20, 200)
dump('enum-value', 'function W({value:', 20, 250)
dump('onWriteNew-call', 'onWriteNew:', 200, 200)
dump('Co-gate', '...Co()?[{id:"feedbackDrafts"', 80, 40)
dump('Co-def', 'function Co(){', 20, 200)
dump('transcriptAvailable-assign', 'transcriptAvailable:', 80, 80)

writeFileSync(`${OUT}/gold-1-sr-helpers-247.txt`, lines.join('\n'), 'latin1')
console.log('done')
