// Find ne() in the spawn chunk. Last search for `function ne(` missed because
// it may be `ne=e=>` / imported / or defined with different spacing.
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

const from = 221841815
const to = 221902736
const chunk = s.slice(from, to)

function hits(re, cap = 15) {
  const out = []
  re.lastIndex = 0
  let m
  while ((m = re.exec(chunk)) !== null) {
    out.push(m)
    if (out.length >= cap) break
  }
  return out
}

for (const [label, re] of [
  ['function ne(', /function ne\(/g],
  ['ne=e=>', /ne=e=>/g],
  ['ne=function', /ne=function/g],
  ['ne=(_', /ne=\(/g],
  ['let ne=', /let ne=/g],
  ['var ne=', /var ne=/g],
  ['ne as ', /ne as /g],
  [' as ne,', / as ne[,;}]/g],
  ['ne(e)', /ne\(e\)/g],
  ['ne(t)', /ne\(t\)/g],
]) {
  const found = hits(re)
  console.log(`\n# ${label}: ${found.length}`)
  for (const m of found.slice(0, 8)) {
    console.log(
      `-- @ ${from + m.index} --\n` +
        chunk
          .slice(Math.max(0, m.index - 180), m.index + 220)
          .replace(/\s+/g, ' '),
    )
  }
}

// Also: who is `is` in tl()? already know is = OO.
// Who calls Ht()?
const first = s.slice(221689041, 221790922)
console.log('\n\n########## Ht( callers ##########')
for (const m of first.matchAll(/\bHt\(/g)) {
  console.log(
    `-- @ ${221689041 + m.index} --\n` +
      first
        .slice(Math.max(0, m.index - 200), m.index + 200)
        .replace(/\s+/g, ' '),
  )
}
