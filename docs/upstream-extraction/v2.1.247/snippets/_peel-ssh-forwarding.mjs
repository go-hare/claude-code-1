// Does upstream 2.1.247 have `claude ssh` at all, and if so what does it
// forward to the remote CLI spawn?
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')
console.log(`# SEA 247 ${BIN} bytes=${s.length}`)

const markers = [
  // transport internals unique to our createSSHSession
  'StreamLocalBindUnlink',
  'ANTHROPIC_AUTH_SOCKET',
  'claude-ssh-auth-',
  '--remote-bin',
  // our own error string
  'is not supported with claude ssh',
  // generic ssh command surface
  'claude ssh',
  'Connect to a remote host',
  // sibling remote surfaces that DO exist upstream, as a positive control
  '--fallback-model',
  'remote-control',
]

for (const m of markers) {
  const hits = []
  let i = -1
  while ((i = s.indexOf(m, i + 1)) !== -1) {
    hits.push(i)
    if (hits.length >= 6) break
  }
  console.log(`${hits.length ? 'HIT ' : '--- '} ${m}  ${hits.join(',')}`)
}

// If `ssh` is a registered commander subcommand upstream, it shows up next to
// the other subcommand names. Dump the neighbourhood of a known one.
const probe = s.indexOf('remote-control')
if (probe !== -1) {
  console.log('\n# --- context around first "remote-control" ---')
  console.log(JSON.stringify(s.slice(probe - 400, probe + 400)))
}
