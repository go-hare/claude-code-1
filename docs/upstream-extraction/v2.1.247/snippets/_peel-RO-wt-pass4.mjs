// Peel _313.js (IG/JG/KG = Ge/We/pe) and _502.js (ydb = Bi).
import { readFileSync } from 'node:fs'

const BIN =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const s = readFileSync(BIN, 'latin1')

function aroundExport(modPath, names) {
  const mark = `B:/~BUN/root/${modPath}`
  // The export lives at the END of that chunk. Find the chunk that *is* that file
  // by searching `// @bun` after a unique string inside... easier: search
  // `from"B:/~BUN/root/${modPath}"` is the importer. The module itself starts
  // with a comment then its own path is not self-referenced.
  // Find `export{... IG as` or `IG as` near the string table of that file.
  console.log(`\n\n########## looking for ${modPath} exports ${names} ##########`)
  for (const n of names) {
    const needle = `${n} as `
    let from = 0
    let hits = 0
    while (hits < 8) {
      const at = s.indexOf(needle, from)
      if (at === -1) break
      from = at + 1
      const win = s.slice(Math.max(0, at - 80), at + 80)
      if (!win.includes(' as ')) continue
      // only export-looking
      if (!/export\{/.test(s.slice(Math.max(0, at - 400), at + 80)) && !win.includes('export')) {
        // still print if nearby has export
      }
      const ctx = s.slice(Math.max(0, at - 300), at + 120).replace(/\s+/g, ' ')
      if (ctx.includes('export{') || ctx.includes('export {')) {
        hits++
        console.log(`\n-- ${n} export @ ${at} --\n${ctx}`)
      }
    }
  }
}

aroundExport('_313.js', ['IG', 'JG', 'KG'])
aroundExport('_502.js', ['ydb'])

// Direct: find `IG as Ge` already known. Search `function IG` / `IG=` / `JG=[`
for (const needle of [
  'function IG(',
  'IG=function',
  'JG=["',
  'JG=[',
  'function KG(',
  'KG=function',
  'ydb=["',
  'ydb=[',
]) {
  const at = s.indexOf(needle)
  console.log(`\n\n########## ${needle} @ ${at} ##########`)
  if (at !== -1) console.log(s.slice(at, at + 900).replace(/\s+/g, ' '))
}

// Also: dispatch-chunk `bs` import. Find ` as bs` near 221689041
const dFrom = 221680000
const dTo = 221792000
const d = s.slice(dFrom, dTo)
const bsImp = [...d.matchAll(/ as bs[,;}]/g)]
console.log(`\n# as bs in dispatch window: ${bsImp.length}`)
for (const m of bsImp) {
  console.log(
    d.slice(Math.max(0, m.index - 200), m.index + 80).replace(/\s+/g, ' '),
  )
}
