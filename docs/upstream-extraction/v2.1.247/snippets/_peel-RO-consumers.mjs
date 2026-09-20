// RO is exported as qOc and never called in its own chunk. Find the importers.
// Also pin down D_ (the other denylist AE() consults) so the guard can be ported.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function scan(name, cap = 20) {
  console.log(`\n\n########## ${name} ##########`)
  const re = new RegExp(`\\b${name}\\b`, 'g')
  let m
  let n = 0
  while ((m = re.exec(s)) !== null) {
    n++
    if (n > cap) {
      console.log(`... capped at ${cap}`)
      break
    }
    console.log(
      `\n-- ${n} @ ${m.index} --\n` +
        s.slice(Math.max(0, m.index - 240), m.index + 240).replace(/\s+/g, ' '),
    )
  }
  console.log(`\n# ${name} total: ${n}`)
}

scan('qOc')

// D_ is declared in the same chunk as OE; print its literal.
const d = s.indexOf('D_=["CLAUDE_CODE_USE_BEDROCK"')
console.log(`\n\n########## D_ @ ${d} ##########`)
console.log(s.slice(d, d + 420).replace(/\s+/g, ' '))

// The list-builder that consumes AE(_).
const a = s.indexOf('"ANTHROPIC_CUSTOM_HEADERS",...R_')
console.log(`\n\n########## AE consumer @ ${a} ##########`)
console.log(s.slice(a - 700, a + 500).replace(/\s+/g, ' '))
