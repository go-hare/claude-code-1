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

const i = 214524794
writeFileSync(
  'docs/upstream-extraction/v2.1.247/snippets/gold-dig-U-dollar.txt',
  `# U$ @${i}\n\n${asciiWindow(buf, i - 80, i + 2200)}\n`,
)
console.log(asciiWindow(buf, i, i + 1800))
