// Full _313.js D/O/pe and _502.js se/ie/re.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

const dAt = s.indexOf(
  'var D=["CLAUDE_CODE_SAFE_MODE","CLAUDE_CODE_SIMPLE"',
)
console.log('D @', dAt)
console.log('\n########## full D + following 2500 ##########')
console.log(s.slice(dAt, dAt + 3500).replace(/\s+/g, ' '))

const oAt = s.indexOf(
  'function O(E){let _=E.CLAUDE_CODE_ENTRYPOINT',
)
console.log('\n\n########## O + neighbors ##########')
console.log(s.slice(oAt - 200, oAt + 400).replace(/\s+/g, ' '))

// export of this chunk
const exp = s.indexOf('// @bun @bytecode', dAt + 100)
console.log('\n\n########## export before next chunk @', exp)
console.log(s.slice(exp - 500, exp).replace(/\s+/g, ' '))

// se ie re in _502
const oe = s.indexOf('Oe=[...se,...ie]')
console.log('\n\n########## 1500 before Oe ##########')
console.log(s.slice(oe - 1800, oe + 200).replace(/\s+/g, ' '))
