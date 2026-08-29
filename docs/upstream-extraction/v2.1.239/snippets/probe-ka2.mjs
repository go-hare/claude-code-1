import { readFileSync } from "fs"
const exe = "D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe"
const text = readFileSync(exe).toString("latin1")
const anchor = text.indexOf(",ozs=KA?")
const region = text.slice(anchor - 25000, anchor + 50)
// find all KA= 
let idx = 0
while (true) {
  const i = region.indexOf("KA=", idx)
  if (i < 0) break
  console.log(region.slice(Math.max(0,i-30), i+60).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))
  idx = i + 3
}
console.log("\n--- Vs() near ---")
idx = 0
let n = 0
while (n < 20) {
  const i = region.indexOf("Vs()", idx)
  if (i < 0) break
  console.log(i, region.slice(Math.max(0,i-40), i+50).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))
  idx = i + 3
  n++
}
