// Oe as ydb (Bi), ee as zdb (bs). Also the 221593821 list (likely We/pe).
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function win(at, before, after) {
  return s.slice(Math.max(0, at - before), at + after).replace(/\s+/g, ' ')
}

const exp = 208929663
console.log('########## _502 export neighborhood ##########')
console.log(win(exp, 2000, 400))

// Find Oe=[ and ee=[ walking back from the export
const chunkStart = s.lastIndexOf('// @bun @bytecode', exp)
console.log('\n_502 chunk starts ~', chunkStart)

const chunk = s.slice(chunkStart, exp + 50)
for (const [label, re] of [
  ['Oe=[', /Oe=\[/g],
  ['var Oe=', /var Oe=/g],
  ['ee=[', /ee=\[/g],
  ['var ee=', /var ee=/g],
  ['ee=new', /ee=new /g],
]) {
  const found = [...chunk.matchAll(re)]
  console.log(`\n# ${label}: ${found.length}`)
  for (const m of found.slice(0, 4)) {
    console.log(
      `-- @ ${chunkStart + m.index} --\n` +
        chunk.slice(m.index, m.index + 600).replace(/\s+/g, ' '),
    )
  }
}

console.log('\n\n########## list @ 221593821 ##########')
console.log(win(221593821, 800, 800))

// _313: search export{ IG as
const ig = s.indexOf('IG as')
console.log('\n\n########## IG as sites ##########')
let from = 0
let n = 0
while (n < 10) {
  const at = s.indexOf('IG as', from)
  if (at === -1) break
  from = at + 1
  const ctx = s.slice(at - 60, at + 80)
  if (ctx.includes('export') || ctx.includes('JG')) {
    n++
    console.log(`-- @ ${at} --\n${ctx.replace(/\s+/g, ' ')}`)
  }
}
