/**
 * Phase 10 leftover 247 #25 — complete ie/k module + regexes vs 246 h.
 */
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'

const b247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const b246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function sha(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16)
}

function asciiSlice(buf, start, end) {
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
  writeFileSync(`${outDir}/${name}`, text.endsWith('\n') ? text : `${text}\n`)
  console.log('WROTE', name, text.length)
}

const k247 = 207249221
const h246 = 205610690

dump(
  'gold-25-escape-247-ie-module.txt',
  `# 247 k/n0c module @${k247}\n\n${asciiSlice(b247, k247 - 2500, k247 + 4500)}\n`,
)
dump(
  'gold-25-escape-246-ie-module.txt',
  `# 246 h/uYc module @${h246}\n\n${asciiSlice(b246, h246 - 2500, h246 + 4500)}\n`,
)

dump(
  'gold-25-escape-247-ie-export.txt',
  `# 247 export near n0c\n\n${asciiSlice(b247, 207251400, 207252200)}\n`,
)
dump(
  'gold-25-escape-246-ie-export.txt',
  `# 246 export near uYc\n\n${asciiSlice(b246, 205612800, 205613400)}\n`,
)

console.log('247 k sha', sha(asciiSlice(b247, k247, k247 + 160)))
console.log('246 h sha', sha(asciiSlice(b246, h246, h246 + 103)))
console.log('phase10 done')
