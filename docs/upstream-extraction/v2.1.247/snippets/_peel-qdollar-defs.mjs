// Resolve every minified identifier used by upstream 2.1.247 q$() / J$() before
// reimplementing them. q$ sits just above J$ at ~208881667.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

// q$ definition and its immediate neighbourhood.
console.log('=== region above J$ (contains q$) ===')
console.log(s.slice(208881200, 208881900).replace(/\s+/g, ' '))

// Definitions of the helpers q$ leans on. Search within the same chunk so the
// short names resolve to the right bindings.
const CHUNK_FROM = 208700000
const CHUNK_TO = 209000000
const chunk = s.slice(CHUNK_FROM, CHUNK_TO)

for (const name of ['tx', 'tt', 'nt', 'tn', 'pm', 'fe', '_e', 'Xe', 'mi']) {
  for (const form of [`function ${name}(`, `${name}=()=>`, `${name}=(`]) {
    let i = -1
    let n = 0
    while ((i = chunk.indexOf(form, i + 1)) !== -1 && n < 3) {
      n++
      console.log(
        `\n--- ${form}  @ ${CHUNK_FROM + i} ---\n` +
          chunk.slice(i, i + 420).replace(/\s+/g, ' '),
      )
    }
  }
}
