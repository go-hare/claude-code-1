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

dump('feedback-cmd-name', 'name:"feedback",description:"Send feedback to Anthropic', 80, 1200)
dump('bug-cmd-name', 'name:"bug",description:"Report a bug or share', 80, 1200)
dump('Rs-jsx', 'T({messages:', 80, 400)
dump('call-feedback-sr', 'onWriteNew', 200, 250)
dump('Ufs-then-sr', 'Ufs()?t(T', 40, 200)
dump('Ufs-then-iT', 'Ufs()?i(T', 40, 200)
dump('aLt-then-T', 'aLt()?t(T', 40, 200)
dump('export-call-feedback', 'export{zHs', 20, 200)
dump('function-call-feedback', 'async function zo(', 20, 800)
dump('load-feedback', 'KGt=zHs', 20, 400)

writeFileSync(`${OUT}/gold-1-review-cmd-247.txt`, lines.join('\n'), 'latin1')
console.log('done')
