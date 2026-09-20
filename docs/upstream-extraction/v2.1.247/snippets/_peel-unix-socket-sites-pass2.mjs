// Compact classification pass: one tight window per code site so each upstream
// ANTHROPIC_UNIX_SOCKET behaviour can be mapped onto our code.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

const M = 'ANTHROPIC_UNIX_SOCKET'
let i = -1
let n = 0
while ((i = s.indexOf(M, i + 1)) !== -1) {
  n++
  const win = s.slice(i - 260, i + 260)
  if ((win.match(/\u0000/g) || []).length > 60) continue
  console.log(`\n--- ${n} @ ${i} ---`)
  console.log(win.replace(/\s+/g, ' '))
}
