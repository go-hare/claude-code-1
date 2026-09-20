// Peel Me / ke / Ue / He / ne / is / tl around the RO() child-env builders.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function win(at, before = 500, after = 400) {
  return s.slice(Math.max(0, at - before), at + after).replace(/\s+/g, ' ')
}

// Known import aliases from previous peel:
// chunk ~221841815:
//   WNc as yi  (D_)
//   aOc as Ri
//   bOc as ke
//   cOc as Me
//   dOc as bi
//   hOc as He
//   kOc as Be
//   pOc as Ti  (OE)
//   qOc as Ve  (RO)
//   sOc as Ue  (AE)
//   wOc as Ci
//
// chunk ~221689041:
//   WNc as Ks
//   bOc as is
//   qOc as ss  (RO)
//   wOc as as

function dumpLiteral(label, needle, extra = 800) {
  const at = s.indexOf(needle)
  console.log(`\n\n########## ${label} @ ${at} ##########`)
  if (at === -1) {
    console.log('NOT FOUND')
    return
  }
  console.log(s.slice(at, at + extra).replace(/\s+/g, ' '))
}

// Export aliases from the RO chunk (_714.js)
const exportAt = s.indexOf('OE as pOc,RO as qOc,SO as rOc,AE as sOc')
console.log('########## export block ##########')
console.log(win(exportAt, 900, 200))

dumpLiteral('R_ list (used in SO)', 'R_=[', 1200)
dumpLiteral('o list (used in SO)', 'o=["', 800)

// The spawn site already known
const spawnAt = 221854086
console.log('\n\n########## spawn Ve site expanded ##########')
console.log(win(spawnAt, 1800, 900))

const spareAt = 221900233
console.log('\n\n########## bg spare Ve site expanded ##########')
console.log(win(spareAt, 1200, 700))

const tlAt = 221756001
console.log('\n\n########## tl() site expanded ##########')
console.log(win(tlAt, 400, 600))

// Find the list assignments for Me / ke by walking back from their first
// use... they are imported. Find the source lists in the RO chunk via
// the export names: cOc = R_, bOc = OO
dumpLiteral('OO assignment (ke / bOc)', 'OO=["', 800)
dumpLiteral('R_ assignment via var', 'R_=["ANTHROPIC', 1200)
