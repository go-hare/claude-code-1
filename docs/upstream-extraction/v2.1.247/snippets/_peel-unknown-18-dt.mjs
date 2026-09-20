import { readFileSync, writeFileSync } from 'fs'

const b247 = readFileSync(
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
  return s
}

function dump(name, text) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    text.endsWith('\n') ? text : `${text}\n`,
  )
  console.log('WROTE', name, text.length)
}

for (const i of [208732840, 210172092, 213710265, 230007584, 231863066, 243110148]) {
  dump(
    `gold-18-dt-${i}.txt`,
    `# function dT( @${i}\n\n${asciiWindow(b247, i, i + 800)}\n`,
  )
}

// 246 Qv around LMt claim
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
dump(
  'gold-18-qv-lmt-246.txt',
  `# LMt neighborhood + Qv\n\n${asciiWindow(b246, 214860000, 214863200)}\n`,
)
