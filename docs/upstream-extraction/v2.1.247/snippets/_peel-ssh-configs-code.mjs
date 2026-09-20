// Upstream 2.1.247: the code regions that consume settings.sshConfigs and build
// the actual ssh invocation.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

for (const [label, at, back, fwd] of [
  ['BatchMode / SSH config region', 201633023, 2500, 3500],
  ['"ssh" + SSH config region', 214532061, 2500, 3500],
]) {
  console.log(`\n\n########## ${label} @ ${at} ##########`)
  console.log(JSON.stringify(s.slice(at - back, at + fwd)))
}

// Confirm what the zod combinator aliases are, using unambiguous neighbours in
// the same settings schema: a known array setting and a known record setting.
console.log('\n\n########## zod alias probes ##########')
for (const m of ['sshConfigs:u(f({', 'permissions:f({', 'hooks:']) {
  const j = s.indexOf(m, 207000000)
  console.log(`\n--- ${m} @ ${j} ---`)
  if (j !== -1) console.log(JSON.stringify(s.slice(j - 60, j + 200)))
}
