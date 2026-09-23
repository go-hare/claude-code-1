import { writeFileSync } from 'fs'
import { EXE_248, loadSea, asciiSlice, allHits } from './_peel-248-na-helpers.mjs'

const out =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-16-fh-fields3.txt'
const b = loadSea(EXE_248)
const lines = [
  '# gold-248-16-fh-fields3',
  `when=${new Date().toISOString()}`,
  '',
]

function dumpWin(label, i, before, after) {
  lines.push(`## ${label} @${i}`)
  lines.push(asciiSlice(b, i - before, i + after))
  lines.push('')
}

for (const needle of [
  'Tl.get(',
  'deleteRefused:',
  'overlaidLoadLanded',
  '!de&&',
  'de?',
  ',de)',
  'de&&',
  'de||',
  'if(de',
  'if(!de',
  'nf[',
  'not deleted',
]) {
  const hits = allHits(b, needle).filter(h => h > 192190000 && h < 192290000)
  lines.push(`## needle ${JSON.stringify(needle)} n=${hits.length} ${hits.join(',')}`)
  for (const h of hits.slice(0, 4)) dumpWin(needle, h, 60, 180)
}

// function Di
const diHits = allHits(b, 'function Di(').filter(h => h > 182990000 && h < 183010000)
lines.push(`## function Di( ${diHits.join(',')}`)
for (const h of diHits.slice(0, 2)) dumpWin('Di', h, 0, 220)

writeFileSync(out, lines.join('\n'))
console.log('wrote', out, lines.length)
