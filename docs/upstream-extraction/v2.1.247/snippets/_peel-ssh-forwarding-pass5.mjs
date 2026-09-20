// Upstream 2.1.247: the single `ANTHROPIC_UNIX_SOCKET=` site should be where the
// remote CLI command line is assembled for `claude ssh`.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

const i = s.indexOf('ANTHROPIC_UNIX_SOCKET=')
console.log(`=== ANTHROPIC_UNIX_SOCKET= @ ${i} ===`)
console.log(JSON.stringify(s.slice(i - 3000, i + 3000)))
