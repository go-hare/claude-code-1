// Upstream 2.1.247 `claude ssh`: find the code (not schema) that builds the
// remote CLI invocation, to see which local flags it forwards.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function scan(m, cap = 10) {
  const hits = []
  let i = -1
  while ((i = s.indexOf(m, i + 1)) !== -1) {
    hits.push(i)
    if (hits.length >= cap) break
  }
  return hits
}

for (const m of [
  'ANTHROPIC_UNIX_SOCKET',
  'sshConfigs',
  'identityFile',
  'startDirectory',
  'RemoteForward',
  'BatchMode',
  'ControlMaster',
  'ssh -tt',
  '-tt',
  'unixSocket',
]) {
  const h = scan(m)
  console.log(`${h.length ? 'HIT ' : '--- '} ${m}  n=${h.length}  ${h.slice(0, 6).join(',')}`)
}

// The minified code region is the tail; dump code context (not the string
// table) for ANTHROPIC_UNIX_SOCKET hits that look like JS.
console.log('\n########## ANTHROPIC_UNIX_SOCKET code contexts ##########')
for (const i of scan('ANTHROPIC_UNIX_SOCKET')) {
  const win = s.slice(i - 500, i + 500)
  // heuristic: real code has few NULs
  const nuls = (win.match(/\u0000/g) || []).length
  if (nuls > 40) continue
  console.log(`\n=== @ ${i} (nuls=${nuls}) ===`)
  console.log(JSON.stringify(win))
}

console.log('\n########## sshConfigs code contexts ##########')
for (const i of scan('sshConfigs')) {
  const win = s.slice(i - 600, i + 600)
  const nuls = (win.match(/\u0000/g) || []).length
  if (nuls > 40) continue
  console.log(`\n=== @ ${i} (nuls=${nuls}) ===`)
  console.log(JSON.stringify(win))
}
