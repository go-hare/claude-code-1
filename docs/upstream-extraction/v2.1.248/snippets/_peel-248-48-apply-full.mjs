// densable 2.1.248 #48 — dump full Linux apply function around tGn/eGn/p/S
import { readFileSync, writeFileSync } from 'fs'

const SEA = 'C:/Users/Administrator/AppData/Local/Temp/official-248-linux/package/claude'
const buf = readFileSync(SEA)
const start = 198268400
const len = 4500
const slice = buf.subarray(start, start + len).toString('utf8')

// also dump from first "async function" before tGn call
const wider = buf.subarray(198267000, 198272500).toString('utf8')

writeFileSync(
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-48-apply-full.txt',
  [
    '# gold-248-48-apply-full',
    '',
    '## window @198268400',
    slice,
    '',
    '## wider @198267000',
    wider,
    '',
  ].join('\n'),
)
console.log('WROTE apply-full', slice.length)
