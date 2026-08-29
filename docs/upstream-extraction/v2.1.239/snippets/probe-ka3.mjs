import { readFileSync } from "fs"
const exe = "D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe"
const text = readFileSync(exe).toString("latin1")

function dumpAll(needle, before=40, after=80, max=30) {
  let from = 0, n = 0
  while (n < max) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    // only near REPL region ~3264xxxxx
    if (i > 326000000 && i < 327000000) {
      console.log(i, text.slice(i-before, i+after).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))
      n++
    }
    from = i + needle.length
  }
}
dumpAll("KA=", 20, 60, 40)
console.log("---")
dumpAll(",KA,", 20, 40, 20)
console.log("--- let KA")
dumpAll("let KA,", 10, 100, 10)
dumpAll("KA=Vs()", 10, 40, 10)
dumpAll("KA=!0", 10, 40, 10)
dumpAll("KA=nr", 10, 40, 10)
