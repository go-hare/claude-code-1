// RO (exported qOc) is imported by two chunks as `ss` and `Ve`. Find the calls,
// so we can tell what RO actually gates -- and therefore whether our
// isManagedByHostSession() is missing the ANTHROPIC_UNIX_SOCKET clause.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

const MARK = 'B:/~BUN/root/'

function chunkAround(pos) {
  // Walk forward to the end of the import block, then to the next chunk header.
  const end = s.indexOf('// @bun @bytecode', pos)
  return { from: pos, to: end === -1 ? pos + 250000 : end }
}

for (const [alias, importAt] of [
  ['ss', 221689041],
  ['Ve', 221841815],
]) {
  const { from, to } = chunkAround(importAt)
  const chunk = s.slice(from, to)
  console.log(
    `\n\n############### ${alias}( in chunk ${from}..${to} (${chunk.length}B) ###############`,
  )
  const re = new RegExp(`\\b${alias}\\(`, 'g')
  let m
  let n = 0
  while ((m = re.exec(chunk)) !== null) {
    n++
    if (n > 12) {
      console.log('... capped at 12')
      break
    }
    console.log(
      `\n-- ${alias} call ${n} @ ${from + m.index} --\n` +
        chunk
          .slice(Math.max(0, m.index - 400), m.index + 320)
          .replace(/\s+/g, ' '),
    )
  }
  console.log(`\n# ${alias}( calls: ${n}`)
}
