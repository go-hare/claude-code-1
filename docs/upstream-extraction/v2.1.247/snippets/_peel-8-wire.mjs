// peel #8 lre wire sites: all `,"<kind>",{storageV5` occurrences in 247
import { readFileSync, writeFileSync } from 'fs'

const SEA = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const OUT = 'D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.247/snippets'
const data = readFileSync(SEA, 'latin1')

const kinds = ['stdout', 'additionalContext', 'systemMessage', 'initialUserMessage']
const lines = []
for (const k of kinds) {
  const needle = `,"${k}",{storageV5`
  let idx = -1
  let n = 0
  while ((idx = data.indexOf(needle, idx + 1)) !== -1) {
    const from = Math.max(0, idx - 700)
    const win = data.slice(from, idx + 200)
    lines.push(`### kind=${k} hit=${n} off=${idx}`)
    lines.push(ascii(win))
    lines.push('')
    n++
  }
  lines.push(`# kind=${k} total=${n}`)
  lines.push('')
}

// also: every `lre(` occurrence (awaited or not)
let idx = -1
let n = 0
while ((idx = data.indexOf('lre(', idx + 1)) !== -1) {
  const prev = data[idx - 1]
  // skip identifier-suffix matches (e.g. "Xlre(")
  if (/[A-Za-z0-9_$]/.test(prev)) continue
  lines.push(`### lreCall hit=${n} off=${idx}`)
  lines.push(ascii(data.slice(Math.max(0, idx - 260), idx + 160)))
  lines.push('')
  n++
}
lines.push(`# lre( total=${n}`)

function ascii(s) {
  return s.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

writeFileSync(`${OUT}/gold-8-wire-sites-247.txt`, lines.join('\n'), 'latin1')
console.log('done')
