// peel #8: find the 247 shape that replaced 246's `case"hook_success":if(!...content)break`
import { readFileSync, writeFileSync } from 'fs'

const OUT = 'D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.247/snippets'
const data = readFileSync('C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe', 'latin1')

const lines = []
for (const needle of [
  'case"hook_success"',
  'attachment.type){case',
  '.attachment.content)',
]) {
  let idx = -1
  let n = 0
  while ((idx = data.indexOf(needle, idx + 1)) !== -1) {
    lines.push(`### needle=${needle} hit=${n} off=${idx}`)
    lines.push(ascii(data.slice(Math.max(0, idx - 600), idx + 500)))
    lines.push('')
    n++
    if (n >= 6) break
  }
  lines.push(`# ${needle} total>=${n}`)
}

function ascii(s) {
  return s.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

writeFileSync(`${OUT}/gold-8-ups-247-shape.txt`, lines.join('\n'), 'latin1')
console.log('done')
