// Upstream 2.1.247 schema for forceLoginOrgUUID / forceLoginMethod: does it
// accept an array of org UUIDs? (J$ does `typeof n === "string" ? [n] : n`.)
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

for (const m of ['forceLoginOrgUUID', 'forceLoginMethod']) {
  let i = -1
  let n = 0
  while ((i = s.indexOf(m, i + 1)) !== -1) {
    n++
    const win = s.slice(i - 200, i + 500)
    const nuls = (win.match(/\u0000/g) || []).length
    console.log(`\n--- ${m} #${n} @ ${i} ${nuls > 60 ? '(STRING TABLE)' : '(CODE)'} ---`)
    if (nuls <= 60) console.log(win.replace(/\s+/g, ' '))
  }
  console.log(`\n# ${m} total: ${n}`)
}
