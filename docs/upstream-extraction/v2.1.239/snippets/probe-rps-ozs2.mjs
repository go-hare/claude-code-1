import { readFileSync } from "fs"
const exe = "D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe"
const text = readFileSync(exe).toString("latin1")

function dump(needle, before=400, after=600, max=3) {
  let from = 0, n = 0
  while (n < max) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    console.log(`\n=== ${JSON.stringify(needle)} @${i} ===`)
    console.log(text.slice(Math.max(0,i-before), i+after).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "."))
    from = i + Math.max(1, needle.length)
    n++
  }
}

// find wi= assignment near ozs
dump("ozs=KA?", 800, 400)
dump("wi=RPs", 100, 100, 5)
dump("let wi=", 50, 80, 10)
dump(",wi=RPs()", 50, 100, 5)
dump("wi=RPs()", 80, 120, 5)

// how layout consumes ozs.visible
dump("ozs.visible", 150, 250, 8)
dump(".visible&&", 80, 120, 15)
dump("modal.visible", 100, 200, 5)
