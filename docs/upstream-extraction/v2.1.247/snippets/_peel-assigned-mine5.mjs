import { existsSync, readFileSync, writeFileSync } from 'fs'

const p = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
if (!existsSync(p)) {
  console.log('MISSING 247')
  process.exit(1)
}
const buf = readFileSync(p)
const needle = Buffer.from('this.keyParseState.droppedMousePrefix||this.keyParseState.flushedEscapePrefix')
let from = 0
let n = 0
while (from < buf.length) {
  const i = buf.indexOf(needle, from)
  if (i < 0) break
  n++
  const start = Math.max(0, i - 200)
  const end = Math.min(buf.length, i + 1800)
  let s = ''
  for (let j = start; j < end; j++) {
    const c = buf[j]
    s += c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) ? String.fromCharCode(c) : '.'
  }
  writeFileSync(
    new URL(`./gold-10-app-arm-${n}.txt`, import.meta.url),
    `# offset=${i} hit=${n}\n\n${s}\n`,
  )
  console.log('hit', n, i)
  from = i + needle.length
}
console.log('total', n)
