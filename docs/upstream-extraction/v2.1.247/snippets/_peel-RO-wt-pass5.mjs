// Find _313.js IG/JG/KG bodies and _502.js ydb/zdb lists.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function dump(label, needle, extra = 1000) {
  const at = s.indexOf(needle)
  console.log(`\n\n########## ${label} @ ${at} ##########`)
  if (at === -1) {
    console.log('NOT FOUND')
    return
  }
  console.log(s.slice(at, at + extra).replace(/\s+/g, ' '))
}

dump('TERM_PROGRAM list', '["TERM_PROGRAM","TERM_PROGRAM_VERSION"')
dump('ITERM list', '["ITERM_SESSION_ID","ITERM_PROFILE"')
dump('export IG JG KG', 'IG as Ge,JG as We,KG as pe')

// _502.js chunk: find export of ydb/zdb
dump('ydb as Bi', 'ydb as Bi')
dump('zdb as bs', 'zdb as bs')

// Search export list containing ydb
const ydbExp = s.indexOf('ydb as')
console.log('\n\n########## first ydb as @', ydbExp)
console.log(s.slice(ydbExp - 400, ydbExp + 200).replace(/\s+/g, ' '))

// function that mutates env: look for CLAUDE_CODE_ENTRYPOINT delete patterns
dump(
  'delete ENTRYPOINT vscode',
  'delete e.CLAUDE_CODE_ENTRYPOINT',
)
dump(
  'ENTRYPOINT claude-vscode',
  'claude-vscode',
)

// Search KG as function that takes env - in _313 the names are IG JG KG
// Find chunk that exports those three together
const exp = s.indexOf(',JG,KG')
const exp2 = s.indexOf('JG,KG}')
const exp3 = s.indexOf('IG,JG,KG')
console.log('\n,JG,KG @', exp, 'JG,KG} @', exp2, 'IG,JG,KG @', exp3)
for (const at of [exp, exp2, exp3]) {
  if (at > 0) {
    console.log('\n-- @', at, '--\n', s.slice(at - 200, at + 150).replace(/\s+/g, ' '))
  }
}
