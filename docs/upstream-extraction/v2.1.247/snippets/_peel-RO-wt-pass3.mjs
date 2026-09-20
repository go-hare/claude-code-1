// Find the real start of the spawn chunk and resolve Bi, pe, Ge, We, bs.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

const MARK = 'B:/~BUN/root/'
const known = 221841815
const chunkStart = s.lastIndexOf(MARK, known - 1)
console.log('chunkStart marker @', chunkStart)
console.log(s.slice(chunkStart, chunkStart + 80))

// Walk back to the previous bytecode end so we get the full import block
const prevEnd = s.lastIndexOf('// @bun @bytecode', known)
console.log('prev bytecode @', prevEnd)
const start = prevEnd === -1 ? chunkStart : prevEnd
console.log('\n\n########## from bytecode/marker to 2k after known import ##########')
console.log(s.slice(start, known + 400).replace(/\s+/g, ' '))

// Search a wider window for `var Bi=` / `Bi=[` / ` as Bi`
const wideFrom = 221800000
const wideTo = 221910000
const wide = s.slice(wideFrom, wideTo)
for (const [label, re] of [
  [' as Bi', / as Bi[,;}]/g],
  ['Bi=[', /Bi=\[/g],
  ['var Bi', /var Bi=/g],
  ['function pe(', /function pe\(/g],
  ['pe=(', /pe=\(/g],
  ['function Ge(', /function Ge\(/g],
  [' as pe,', / as pe[,;}]/g],
  [' as Ge,', / as Ge[,;}]/g],
  [' as We,', / as We[,;}]/g],
  ['We=[', /We=\[/g],
  ['var We=', /var We=/g],
  [' as bs,', / as bs[,;}]/g],
  ['bs=[', /\bbs=\[/g],
]) {
  const found = [...wide.matchAll(re)]
  console.log(`\n# wide ${label}: ${found.length}`)
  for (const m of found.slice(0, 4)) {
    console.log(
      `-- @ ${wideFrom + m.index} --\n` +
        wide
          .slice(Math.max(0, m.index - 100), m.index + 350)
          .replace(/\s+/g, ' '),
    )
  }
}
