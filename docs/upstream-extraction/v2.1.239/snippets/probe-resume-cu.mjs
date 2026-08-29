/**
 * Find cu( call sites for resume_return trigger in REPL.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const exe = join(process.env.TEMP || '', 'official-239', 'package', 'claude.exe')
const text = readFileSync(exe).toString('latin1')

// The callback is named cu near iXg(Gm — search after that for cu(
const anchor = text.indexOf('iXg(Gm,')
console.log('iXg(Gm @', anchor)
const region = text.slice(anchor - 500, anchor + 15000)
const cleaned = region.replace(/[^\x20-\x7e]/g, '.')

// Find cu( usages in a larger window around the definition
const def = text.indexOf('cu=ho.useCallback((nr)=>{let Xr=rXg(nr,ZD)')
console.log('cu def @', def)
const win = text.slice(def, def + 50000).replace(/[^\x20-\x7e]/g, '.')

const cuCalls = []
let from = 0
while (cuCalls.length < 20) {
  const i = win.indexOf('cu(', from)
  if (i < 0) break
  cuCalls.push(win.slice(Math.max(0, i - 80), i + 120))
  from = i + 3
}
console.log('cu( in window after def:', cuCalls.length)
for (const c of cuCalls) console.log('---\n', c)

// Also search globally for rXg( with context of callers
const lines = ['## cu window calls', ...cuCalls, '\n## region around iXg', cleaned.slice(0, 3000)]
writeFileSync(
  'docs/upstream-extraction/v2.1.239/snippets/gold-resume-cu-calls.txt',
  lines.join('\n'),
)
