// peel #8: official UserPromptSubmit hook-result consumer (additionalContexts + message)
import { readFileSync, writeFileSync } from 'fs'

const OUT = 'D:/work/py/claude/claude-code/docs/upstream-extraction/v2.1.247/snippets'
const seas = {
  247: 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  246: 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
}

const lines = []
for (const [ver, path] of Object.entries(seas)) {
  const data = readFileSync(path, 'latin1')
  for (const needle of ['hook_additional_context', 'output truncated', 'additionalContexts.map']) {
    let idx = -1
    let n = 0
    while ((idx = data.indexOf(needle, idx + 1)) !== -1) {
      lines.push(`### ver=${ver} needle=${needle} hit=${n} off=${idx}`)
      lines.push(ascii(data.slice(Math.max(0, idx - 900), idx + 900)))
      lines.push('')
      n++
      if (n >= 4) break
    }
    lines.push(`# ver=${ver} needle=${needle} total>=${n}`)
    lines.push('')
  }
}

function ascii(s) {
  return s.replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

writeFileSync(`${OUT}/gold-8-ups-consumer.txt`, lines.join('\n'), 'latin1')
console.log('done')
