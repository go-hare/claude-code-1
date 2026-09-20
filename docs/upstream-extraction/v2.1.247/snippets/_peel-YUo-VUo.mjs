import { readFileSync } from 'fs'

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

const yuo = 214513093
console.log(asciiWindow(buf, yuo - 1500, yuo + 200))

for (const n of [
  'function VUo(',
  'function $Ln(',
  'fm={',
  'fm.system',
  'workspace(e){return{space:"workspace"',
  'system(e){return{space:"system"',
]) {
  const i = buf.indexOf(Buffer.from(n), 214400000)
  console.log('\n', n, i)
  if (i > 0) console.log(asciiWindow(buf, i, i + 280))
}
