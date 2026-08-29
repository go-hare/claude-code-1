import { readFileSync } from "fs"
const text = readFileSync("D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe").toString("latin1")

function dump(needle, before=120, after=200, max=20) {
  let from = 0, n = 0
  while (n < max) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    // skip the definition itself
    if (i !== 322914886) {
      console.log(`\n@${i}`)
      console.log(text.slice(Math.max(0,i-before), i+after).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "."))
      n++
    }
    from = i + needle.length
  }
}

// callers of uQc(
dump("uQc(", 150, 180, 25)
console.log("\n===== uQc(null) / clear =====")
dump("uQc(null)", 80, 80, 10)
dump("uQc(void 0)", 80, 80, 5)
dump("uQc(!1)", 80, 80, 5)
