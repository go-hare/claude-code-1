// peel #8: official UserPromptSubmit consumer — hookName:"UserPromptSubmit" windows
import { readFileSync, writeFileSync } from 'fs'

const OUT = 'D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.247/snippets'
const data = readFileSync('C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe', 'latin1')

const lines = []
const needle = 'hookName:"UserPromptSubmit"'
let idx = -1
let n = 0
while ((idx = data.indexOf(needle, idx + 1)) !== -1) {
  lines.push(`### hit=${n} off=${idx}`)
  lines.push(ascii(data.slice(Math.max(0, idx - 1100), idx + 1300)))
  lines.push('')
  n++
}
lines.push(`# total=${n}`)

function ascii(s) {
  return s.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

writeFileSync(`${OUT}/gold-8-ups-hookname-247.txt`, lines.join('\n'), 'latin1')
console.log(`total=${n}`)
