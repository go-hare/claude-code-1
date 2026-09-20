// Peel He (AO / hOc) and ne() used by the child-env RO() gate.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function win(at, before = 600, after = 500) {
  return s.slice(Math.max(0, at - before), at + after).replace(/\s+/g, ' ')
}

function dump(label, needle, extra = 900) {
  const at = s.indexOf(needle)
  console.log(`\n\n########## ${label} @ ${at} ##########`)
  if (at === -1) {
    console.log('NOT FOUND')
    return
  }
  console.log(s.slice(at, at + extra).replace(/\s+/g, ' '))
}

// AO is exported as hOc. Find its definition in the RO chunk.
dump('function AO', 'function AO(', 1200)
dump('AO=function', 'AO=function', 800)
dump('AO=(_', 'function AO(_)', 1200)

// Also search nearby the RO definition
const ro = s.indexOf('function RO(_){return!!_.ANTHROPIC_UNIX_SOCKET')
console.log('\n\n########## around RO +/- 2500 ##########')
console.log(s.slice(ro - 2500, ro + 1800).replace(/\s+/g, ' '))

// ne(e) is local to the spawn chunk. Search that chunk for function ne
const spawnChunk = s.slice(221841815, 221902736)
const neDef = spawnChunk.search(/function ne\(/)
console.log('\n\n########## function ne( in spawn chunk @', 221841815 + neDef)
if (neDef >= 0) {
  console.log(
    spawnChunk.slice(Math.max(0, neDef - 80), neDef + 400).replace(/\s+/g, ' '),
  )
}

// Ee is isEnvTruthy. Confirm He calls.
const heCalls = [...spawnChunk.matchAll(/\bHe\(/g)]
console.log(`\n# He( calls in spawn chunk: ${heCalls.length}`)
for (const m of heCalls.slice(0, 8)) {
  console.log(
    '\n-- He @',
    221841815 + m.index,
    '--\n',
    spawnChunk
      .slice(Math.max(0, m.index - 200), m.index + 280)
      .replace(/\s+/g, ' '),
  )
}

// tl() consumer: who calls tl()?
const tlChunk = s.slice(221689041, 221790922)
const tlCalls = [...tlChunk.matchAll(/\btl\(/g)]
console.log(`\n# tl( calls in first chunk: ${tlCalls.length}`)
for (const m of tlCalls.slice(0, 8)) {
  console.log(
    '\n-- tl @',
    221689041 + m.index,
    '--\n',
    tlChunk
      .slice(Math.max(0, m.index - 240), m.index + 240)
      .replace(/\s+/g, ' '),
  )
}
