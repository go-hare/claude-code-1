import { writeFileSync } from 'fs'
import { EXE_248, loadSea, asciiSlice } from './_peel-248-na-helpers.mjs'

const b = loadSea(EXE_248)
const i = 192124739
const out = 'docs/upstream-extraction/v2.1.248/snippets/gold-248-16-wo-kc.txt'
const lines = [
  '# gold-248-16-wo-kc',
  asciiSlice(b, i - 400, i + 200),
]
writeFileSync(out, lines.join('\n'))
console.log(lines[1])
