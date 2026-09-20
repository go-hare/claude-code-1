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

// rest of we/et/We after the cut
at('after-we-cut', 237006900, 0, 4500)
dump('plus-write-new', '+ Write new feedback', 300, 400)
dump('transcript-available-label', 'transcript available', 400, 200)
dump('function-et-title', 'function et({title', 20, 900)
dump('Write-new-jsx', 'Write new feedback', 200, 80)
dump('discard-panel', ',"panel",B)', 80, 40)
dump('Hw-discard', 'async function Hw(', 20, 400)
dump('deleteFeedback-surface', 'via:"panel"', 80, 80)
dump('Co-back-from-config', 'function Co()', 20, 250, 225090000)
dump('Ufs-call-config', 'function Co(){return Ufs', 20, 80)
dump('isSend-config', 'feedbackDrafts",label:"Claude-drafted', 200, 80)
dump('cmd-sr', 'onWriteNew:', 80, 200)
dump('feedback-call-sr', 'title:"Feedback drafts"', 200, 80)
dump('p-kGb', 'function p(u){', 20, 200)
dump('be-lGb', 'function be(u){', 20, 200)
dump('sanitize-title-578', 'kGb as p', 40, 40)
dump('Nfs-Dfs', 'async function Dfs(', 20, 500)
dump('ogr-def', 'function ogr(', 20, 400)
dump('list-transcriptAvail', 'transcriptAvailable:o?!1:await Nfs', 250, 80)
dump('He-plural', 'function He(u,g)', 20, 200)
dump('tt-reltime', 'function tt(u)', 20, 250)
dump('It-reqids', 'function It(u)', 20, 200)

writeFileSync(`${OUT}/gold-1-sr-ui-247.txt`, lines.join('\n'), 'latin1')
console.log('done')
