// Resolve Bi, Ri/w_, pe(), Ge(), Be/$_, and the full tl() caller.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function dump(label, needle, extra = 900) {
  const at = s.indexOf(needle)
  console.log(`\n\n########## ${label} @ ${at} ##########`)
  if (at === -1) {
    console.log('NOT FOUND')
    return at
  }
  console.log(s.slice(at, at + extra).replace(/\s+/g, ' '))
  return at
}

// From spawn chunk import:
// WNc as yi  (D_)
// aOc as Ri  (w_)
// kOc as Be  ($_)
// wOc as Ci  (DE module init?)
dump('w_ assignment', 'w_=["')
dump('w_= [', 'w_=[')
dump('$_ assignment startsWith', '$_=[')
dump('$_ some', '$_.some')

// Export block again for aOc / kOc sources
const exp = s.indexOf('w_ as aOc,OO as bOc,R_ as cOc')
console.log('\n\n########## export aliases ##########')
console.log(s.slice(exp - 200, exp + 250).replace(/\s+/g, ' '))

// Bi is local to the spawn chunk
const from = 221841815
const to = 221902736
const chunk = s.slice(from, to)

for (const [label, re] of [
  ['var Bi=', /var Bi=/g],
  ['let Bi=', /let Bi=/g],
  ['Bi=[', /Bi=\[/g],
  ['Bi=new', /Bi=new /g],
  ['function pe(', /function pe\(/g],
  ['pe=e=>', /pe=e=>/g],
  ['function Ge(', /function Ge\(/g],
  ['Ge=e=>', /Ge=e=>/g],
  [' as Bi,', / as Bi[,;}]/g],
  [' as pe,', / as pe[,;}]/g],
  [' as Ge,', / as Ge[,;}]/g],
]) {
  const found = [...chunk.matchAll(re)]
  console.log(`\n# ${label}: ${found.length}`)
  for (const m of found.slice(0, 6)) {
    console.log(
      `-- @ ${from + m.index} --\n` +
        chunk
          .slice(Math.max(0, m.index - 160), m.index + 280)
          .replace(/\s+/g, ' '),
    )
  }
}

// Full tl() caller object
const tlCall = s.indexOf('&&(t==="repl"||!n?.providerEnv&&!r||r===De())&&tl()')
console.log('\n\n########## tl() caller object ##########')
console.log(s.slice(tlCall - 2200, tlCall + 400).replace(/\s+/g, ' '))

// Ht / bs list
dump('function Ht', 'function Ht(){let e={};for(let t of bs)')
dump('bs=[', 'bs=["')
dump('bs= [', 'var bs=')
