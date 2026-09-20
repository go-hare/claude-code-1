// se, ie, re that build Oe (Bi) and ee (bs/Ht).
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

const oe = s.indexOf('Oe=[...se,...ie]')
const chunkStart = s.lastIndexOf('// @bun @bytecode', oe)
const chunk = s.slice(chunkStart, oe + 20)

for (const [label, re] of [
  ['se=[', /se=\[/g],
  ['ie=[', /ie=\[/g],
  ['re=[', /re=\[/g],
  ['var se=', /var se=/g],
  ['se=new', /se=new /g],
  [' as se,', / as se[,;}]/g],
  [' as ie,', / as ie[,;}]/g],
  [' as re,', / as re[,;}]/g],
]) {
  const found = [...chunk.matchAll(re)]
  console.log(`\n# ${label}: ${found.length}`)
  for (const m of found.slice(0, 4)) {
    console.log(
      `-- @ ${chunkStart + m.index} --\n` +
        chunk
          .slice(Math.max(0, m.index - 80), m.index + 700)
          .replace(/\s+/g, ' '),
    )
  }
}

// ye() is called before Oe assignment - maybe initializes se/ie/re from _714
console.log('\n\n########## 3k before Oe (inits) ##########')
console.log(s.slice(oe - 3500, oe).replace(/\s+/g, ' '))
