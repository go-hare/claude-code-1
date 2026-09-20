// Find upstream 2.1.247's commander registration for the `ssh` subcommand and
// whatever builds its remote invocation.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function codeHits(m, cap = 40) {
  const out = []
  let i = -1
  while ((i = s.indexOf(m, i + 1)) !== -1) {
    const win = s.slice(i - 300, i + 300)
    const nuls = (win.match(/\u0000/g) || []).length
    if (nuls <= 20) out.push(i)
    if (out.length >= cap) break
  }
  return out
}

// commander registration shapes
for (const m of [
  '.command("ssh',
  ".command('ssh",
  'command("ssh',
  '"ssh <',
  '"ssh "',
  'hasSSH',
  'ANTHROPIC_UNIX_SOCKET=',
  'stream-json',
]) {
  const h = codeHits(m, 12)
  console.log(`${h.length ? 'HIT ' : '--- '} ${m}  n=${h.length}  ${h.slice(0, 8).join(',')}`)
}

console.log('\n########## hasSSH contexts ##########')
for (const i of codeHits('hasSSH', 6)) {
  console.log(`\n=== @ ${i} ===`)
  console.log(JSON.stringify(s.slice(i - 900, i + 500)))
}

console.log('\n########## "ssh <" contexts ##########')
for (const i of codeHits('"ssh <', 6)) {
  console.log(`\n=== @ ${i} ===`)
  console.log(JSON.stringify(s.slice(i - 700, i + 1400)))
}
