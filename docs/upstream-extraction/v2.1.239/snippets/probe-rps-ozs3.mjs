import { readFileSync } from "fs"
const exe = "D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe"
const text = readFileSync(exe).toString("latin1")

function dump(needle, before=300, after=500, max=5) {
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

// Find fullscreen layout that takes modal/ozs prop
dump("modal:", 80, 200, 10)
dump("ozs,", 100, 150, 10)
dump("visible:ozs", 100, 200, 5)
dump("ozs&&", 80, 200, 8)
dump("ozs?", 80, 200, 8)
dump(".visible?", 80, 200, 15)

// Search for ▔ or permission-colored divider near modal
dump("\\u2580", 50, 100, 5) // might not work in latin1
dump("'▔'", 50, 150, 5)
dump('"▔"', 50, 150, 5)

// How UUo / fullscreen consumes modal
dump("function UUo", 20, 800, 2)
dump("modal:ozs", 150, 300, 5)
dump("modal:e", 50, 100, 10)
