// Who PRODUCES hasSSH upstream? That tells us what `claude ssh` actually is in
// 2.1.247 -- a shipped command, or a schema-only forward declaration.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function all(m, from = 0) {
  const out = []
  let i = from - 1
  while ((i = s.indexOf(m, i + 1)) !== -1) out.push(i)
  return out
}

console.log('sshConfigs total occurrences:', all('sshConfigs').length)
console.log('hasSSH total occurrences    :', all('hasSSH').length)

console.log('\n########## hasSSH @ 222790197 (unseen) ##########')
console.log(JSON.stringify(s.slice(222790197 - 1800, 222790197 + 1200)))

// Anything that looks like the ssh subcommand being entered / detected.
console.log('\n########## entry-point probes ##########')
for (const m of [
  'ssh:',
  '"ssh",',
  "'ssh',",
  'isSSH',
  'sshRemote',
  'sshHost',
  'startDirectory',
  'claude-ssh',
  'sshSession',
  'SSHSession',
]) {
  const h = all(m)
  console.log(`${h.length ? 'HIT ' : '--- '} ${m}  n=${h.length}  ${h.slice(0, 8).join(',')}`)
}
