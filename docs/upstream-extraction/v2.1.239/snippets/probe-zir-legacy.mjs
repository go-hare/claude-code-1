import { readFileSync, writeFileSync } from "fs"
const text = readFileSync("D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe").toString("latin1")

function dump(needle, before=200, after=500, max=8) {
  let from = 0, n = 0
  while (n < max) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    console.log(`\n=== ${JSON.stringify(needle)} @${i} ===`)
    console.log(text.slice(Math.max(0,i-before), i+after).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "."))
    from = i + Math.max(1, needle.length)
    n++
  }
  if (!n) console.log("MISS", needle)
}

dump("legacyDialogFocus", 150, 400, 15)
dump("function oIA", 50, 300)
dump("function zIr", 50, 250)
dump("setLegacyDialogFocus", 80, 200, 10)
dump("legacyDialogFocus.setState", 100, 250, 12)
dump('"legacy-dialog"', 80, 200, 10)
