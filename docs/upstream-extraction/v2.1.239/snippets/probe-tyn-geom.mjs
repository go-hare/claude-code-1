import { readFileSync, writeFileSync } from "fs"
const exe = "D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe"
const text = readFileSync(exe).toString("latin1")

// Extract fuller Tyn fullscreen branch - find function Tyn and take until function lRc
const start = text.indexOf("function Tyn(")
const end = text.indexOf("function lRc(", start)
const chunk = text.slice(start, end)
writeFileSync("docs/upstream-extraction/v2.1.239/snippets/gold-tyn-full.txt", chunk)
console.log("Tyn len", chunk.length)

// Key structural bits
for (const needle of [
  "position:\"absolute\"",
  "opaque",
  "display:zkr",
  "display:KTg",
  "char:\"\\u2594\"",
  "paddingX:Aee",
  "flexShrink:0,width:\"100%\",maxHeight",
  "bottomFloat",
  "companion",
]) {
  const i = chunk.indexOf(needle)
  console.log(needle, i)
}

// How Ob divider works
const ob = text.indexOf("function Ob(")
console.log("\nOb:", text.slice(ob, ob+250).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))

// Aee padding constant
const aee = text.indexOf("Aee=")
console.log("\nAee nearby:", text.slice(Math.max(0,aee-20), aee+80).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))

// UAt MODAL peek
let from = 0, n = 0
while (n < 5) {
  const i = text.indexOf("UAt=", from)
  if (i < 0) break
  if (i > 321000000 && i < 322000000) {
    console.log("UAt@", i, text.slice(i, i+40))
    n++
  }
  from = i + 3
}
