/**
 * Is `preflight_endpoint` a member of the upstream exit-reason enum, or a
 * separate telemetry/exit-marker channel? Peel around the enum literal.
 */
import { readFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function findAll(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

// The enum appears as a JS array literal in the bundled source.
for (const needle of [
  '"prompt_input_exit"',
  'bypass_permissions_disabled"',
]) {
  const hits = findAll(needle)
  console.log(`\n##### ${needle} — ${hits.length} hit(s)`)
  for (const [n, at] of hits.entries()) {
    const win = ascii(at - 400, at + 400)
    if (!/[[,]/.test(win)) continue
    console.log(`\n=== hit ${n} @${at} ===\n${win}`)
  }
}
