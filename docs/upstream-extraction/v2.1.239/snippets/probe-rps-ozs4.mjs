import { readFileSync } from "fs"
const exe = "D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe"
const text = readFileSync(exe).toString("latin1")
const i = text.indexOf("HCn=Vs()&&us?.isLocalJSXCommand===!0")
console.log(text.slice(i, i+1200).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "."))
console.log("\n--- PCn usages near ---")
let from = i, n = 0
while (n < 15) {
  const j = text.indexOf("PCn", from)
  if (j < 0 || j > i + 3000) break
  console.log(j-i, text.slice(j-20, j+40).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "."))
  from = j + 3
  n++
}
console.log("\n--- kZt ---")
const k = text.indexOf("kZt=KA&&wi===", i-500)
console.log(text.slice(k, k+400).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "."))

// Zwn = typing?
console.log("\n--- Zwn ---")
const z = text.indexOf("function Zwn")
console.log(text.slice(z, z+300).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "."))
