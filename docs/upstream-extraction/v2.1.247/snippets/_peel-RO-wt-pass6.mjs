// _313.js sits next to _314.js in the string table. Find the JS that
// mentions CLAUDE_CODE_QUESTION_PREVIEW_FORMAT as a quoted identifier,
// and the _502.js ydb/zdb lists.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function all(needle, cap = 8) {
  const out = []
  let from = 0
  while (out.length < cap) {
    const at = s.indexOf(needle, from)
    if (at === -1) break
    out.push(at)
    from = at + needle.length
  }
  return out
}

console.log('\n########## CLAUDE_CODE_QUESTION_PREVIEW_FORMAT sites ##########')
for (const at of all('CLAUDE_CODE_QUESTION_PREVIEW_FORMAT', 12)) {
  const ctx = s.slice(Math.max(0, at - 80), at + 200)
  const printable = /["'`=\[\]]/.test(ctx.slice(0, 80))
  console.log(
    `\n-- @ ${at} printable=${printable} --\n` + ctx.replace(/\s+/g, ' ').slice(0, 400),
  )
}

console.log('\n########## ydb= / zdb= ##########')
for (const n of ['ydb=', 'zdb=', 'ydb=[', 'zdb=[']) {
  for (const at of all(n, 5)) {
    console.log(`\n-- ${n} @ ${at} --\n` + s.slice(at, at + 500).replace(/\s+/g, ' '))
  }
}

// export block of _502.js: search "ydb," near "zdb"
const yz = s.indexOf('ydb,')
console.log('\n########## ydb, @', yz)
if (yz > 0) console.log(s.slice(yz - 250, yz + 250).replace(/\s+/g, ' '))

// _313.js export: "IG," near KG
for (const n of [',IG,', 'IG,JG', 'KG,IG', 'function KG(e){let', 'function IG(e){let']) {
  const at = s.indexOf(n)
  console.log(`\n# ${n} @ ${at}`)
  if (at > 0) console.log(s.slice(at - 100, at + 400).replace(/\s+/g, ' '))
}

// Look at code around the string-table neighbor: file:///B:/~BUN/root/_313.js
const p313 = s.indexOf('file:///B:/~BUN/root/_313.js')
console.log('\n########## file _313.js @', p313)
if (p313 > 0) {
  console.log(s.slice(p313 - 200, p313 + 80).replace(/\s+/g, ' '))
}
const p313b = s.indexOf('B:/~BUN/root/_313.js')
console.log('first _313.js path @', p313b)
console.log(s.slice(p313b - 80, p313b + 40))
