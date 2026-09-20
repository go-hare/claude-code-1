// Every upstream 2.1.247 site that treats ANTHROPIC_UNIX_SOCKET specially, so
// each can be mapped onto our code. This is the `claude ssh` remote marker.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

const M = 'ANTHROPIC_UNIX_SOCKET'
let i = -1
let n = 0
while ((i = s.indexOf(M, i + 1)) !== -1) {
  n++
  const win = s.slice(i - 700, i + 700)
  const nuls = (win.match(/\u0000/g) || []).length
  console.log(`\n=== site ${n} @ ${i}  nuls=${nuls} ${nuls > 60 ? '(STRING TABLE)' : '(CODE)'} ===`)
  if (nuls <= 60) console.log(JSON.stringify(win))
}
console.log(`\n# total sites: ${n}`)
