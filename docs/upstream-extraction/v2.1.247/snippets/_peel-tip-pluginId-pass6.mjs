/**
 * Pass 6: confirm Tm/te same-module as _839 export; dump Tm neighbors.
 */
import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

const te = 206941696
const tm = 206986838
const exp = 207021184
const betweenTeExp = asciiWindow(buf, te, exp)
const betweenTmExp = asciiWindow(buf, tm, exp)
const bunTe = (betweenTeExp.match(/@bun @bytecode/g) || []).length
const bunTm = (betweenTmExp.match(/@bun @bytecode/g) || []).length
const verTe = (betweenTeExp.match(/Version: 2.1.247/g) || []).length
const verTm = (betweenTmExp.match(/Version: 2.1.247/g) || []).length

const report = [
  `# te@${te} tm@${tm} export@{${exp}}`,
  `bytecode between te..export: ${bunTe}`,
  `bytecode between tm..export: ${bunTm}`,
  `Version between te..export: ${verTe}`,
  `Version between tm..export: ${verTm}`,
  `Tm neighbor:`,
  asciiWindow(buf, tm - 400, tm + 700),
]

writeFileSync(`${outDir}/gold-tip-pluginId-Tm-neigh.txt`, report.join('\n') + '\n')
writeFileSync(
  `${outDir}/gold-tip-pluginId-te-neigh.txt`,
  `# class te @${te}\n${asciiWindow(buf, te - 200, te + 400)}\n`,
)
console.log(report.slice(0, 6).join('\n'))
