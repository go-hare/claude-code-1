// Upstream 2.1.247 J$ (validateForceLoginOrg): the full ANTHROPIC_UNIX_SOCKET
// branch, including the analytics reasons we are missing.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

console.log('=== J$ @ 208881853 ===')
console.log(s.slice(208881853 - 900, 208881853 + 2600).replace(/\s+/g, ' '))

console.log('\n\n=== auth_force_login_org reason strings ===')
for (const m of [
  'unix_socket_3p_under_pin',
  'unix_socket_ssh_under_pin',
  'managed_by_host_under_pin',
  'auth_force_login_org',
]) {
  const hits = []
  let i = -1
  while ((i = s.indexOf(m, i + 1)) !== -1) {
    hits.push(i)
    if (hits.length >= 8) break
  }
  console.log(`${hits.length ? 'HIT ' : '--- '} ${m}  n=${hits.length}  ${hits.join(',')}`)
}
