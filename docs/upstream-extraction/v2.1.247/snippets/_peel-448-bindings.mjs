import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

const cea = 219687440
const vea = 219687366
console.log('window:\n', asciiWindow(buf, vea - 2500, cea + 80))

writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-448-bindings.txt',
  `# vea@${vea} Cea@${cea}\n\n${asciiWindow(buf, vea - 4000, cea + 200)}\n`,
)
