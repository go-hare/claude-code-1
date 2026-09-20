// Upstream 2.1.247: what calls RO() and what consumes OE?
//   RO(_) { return !!_.ANTHROPIC_UNIX_SOCKET || N(_.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)
//                  || !!_.CLAUDE_CODE_HOST_AUTH_ENV_VAR }
//   OE = ["ANTHROPIC_UNIX_SOCKET","CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
//         "CLAUDE_CODE_HOST_AUTH_ENV_VAR"]
// Both are two-char minified names, so scan the enclosing chunk by whole-word
// regex rather than substring search.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

const RO_DEF = s.indexOf('function RO(_){return!!_.ANTHROPIC_UNIX_SOCKET')
console.log('RO definition @', RO_DEF)

// Bun SEA chunks are delimited by these virtual module paths.
const MARK = 'B:/~BUN/root/'
const chunkStart = s.lastIndexOf(MARK, RO_DEF - 200000) // step back past imports
const chunkEnd = s.indexOf(MARK, RO_DEF + 120000)
// Fall back to a fixed window if the markers are far away.
const from = Math.max(0, chunkStart === -1 ? RO_DEF - 200000 : chunkStart - 4000)
const to = chunkEnd === -1 ? RO_DEF + 200000 : chunkEnd + 4000
const chunk = s.slice(from, to)
console.log(`scanning ${from}..${to}  (${chunk.length} bytes)`)

function scan(name) {
  console.log(`\n\n########## \\b${name}\\b ##########`)
  const re = new RegExp(`\\b${name}\\b`, 'g')
  let m
  let n = 0
  while ((m = re.exec(chunk)) !== null) {
    n++
    if (n > 40) {
      console.log('... capped at 40')
      break
    }
    const at = from + m.index
    const win = chunk
      .slice(Math.max(0, m.index - 170), m.index + 170)
      .replace(/\s+/g, ' ')
    console.log(`\n-- ${n} @ ${at} --\n${win}`)
  }
  console.log(`\n# ${name} whole-word count in chunk: ${n}`)
}

scan('RO')
scan('OE')
