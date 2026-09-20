// peel #8: confirm 247 keeps the hook_success empty-content switch, no truncation
import { readFileSync, writeFileSync } from 'fs'

const OUT = 'D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.247/snippets'
const lines = []
for (const [ver, path] of [
  ['247', 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'],
  ['246', 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'],
]) {
  const data = readFileSync(path, 'latin1')
  const needle = 'case"hook_success":if(!'
  let idx = -1
  let n = 0
  while ((idx = data.indexOf(needle, idx + 1)) !== -1) {
    lines.push(`### ver=${ver} hit=${n} off=${idx}`)
    lines.push(ascii(data.slice(Math.max(0, idx - 500), idx + 320)))
    lines.push('')
    n++
  }
  lines.push(`# ver=${ver} case"hook_success":if(! total=${n}`)
  for (const extra of ['truncated - exceeded', 'additionalContexts.map', 'substring(0,1e4)', 'substring(0,10000)']) {
    lines.push(`# ver=${ver} ${extra} count=${count(data, extra)}`)
  }
  lines.push('')
}

function count(data, needle) {
  let idx = -1
  let n = 0
  while ((idx = data.indexOf(needle, idx + 1)) !== -1) n++
  return n
}
function ascii(s) {
  return s.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

writeFileSync(`${OUT}/gold-8-ups-switch.txt`, lines.join('\n'), 'latin1')
console.log('done')
