// Full J_ (eOc/se) and Z_ (fOc/ie).
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

const j = s.indexOf('J_=["ANTHROPIC_MODEL","ANTHROPIC_DEFAULT_MODEL"')
console.log('J_ @', j)
console.log(s.slice(j, j + 2200).replace(/\s+/g, ' '))

const z = s.indexOf('Z_=[', j)
console.log('\n\nZ_ after J_ @', z)
console.log(s.slice(z, z + 1200).replace(/\s+/g, ' '))
