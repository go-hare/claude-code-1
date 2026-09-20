// What are the six "claude ssh" occurrences in upstream 2.1.247?
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

let i = -1
let n = 0
while ((i = s.indexOf('claude ssh', i + 1)) !== -1 && n < 12) {
  n++
  console.log(`\n=== hit ${n} @ ${i} ===`)
  console.log(JSON.stringify(s.slice(i - 300, i + 300)))
}

// Also: is there a commander `.command('ssh')` style registration?
for (const m of [
  "'ssh'",
  '"ssh"',
  'ssh <host>',
  'ssh [host]',
  'sshRemote',
  'SSH_REMOTE',
]) {
  const hits = []
  let j = -1
  while ((j = s.indexOf(m, j + 1)) !== -1) {
    hits.push(j)
    if (hits.length >= 8) break
  }
  console.log(`\n${hits.length ? 'HIT ' : '--- '} ${m}  ${hits.join(',')}`)
  if (hits.length) console.log(JSON.stringify(s.slice(hits[0] - 200, hits[0] + 200)))
}
