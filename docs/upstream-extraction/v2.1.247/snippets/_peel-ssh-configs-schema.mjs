// Full zod schema for upstream 2.1.247 settings.sshConfigs, plus any
// user-facing strings for resolving `claude ssh <config>`.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

// The code-region hit (not the string table) is the zod object literal.
const i = s.indexOf('sshConfigs', 208000000)
console.log(`=== sshConfigs zod @ ${i} ===`)
console.log(JSON.stringify(s.slice(i - 2200, i + 900)))

console.log('\n\n=== candidate resolution / error strings ===')
for (const m of [
  'sshConfig',
  'SSH config',
  'ssh config',
  'No SSH config',
  'Unknown SSH',
  'not found in sshConfigs',
  'startDirectory',
  'identity file',
  'SSH port',
]) {
  const hits = []
  let j = -1
  while ((j = s.indexOf(m, j + 1)) !== -1) {
    hits.push(j)
    if (hits.length >= 8) break
  }
  console.log(`${hits.length ? 'HIT ' : '--- '} ${m}  n=${hits.length}  ${hits.join(',')}`)
}
