import { readFileSync } from "fs"
const exe = "D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe"
const text = readFileSync(exe).toString("latin1")
const anchor = text.indexOf("ozs=KA?{content:of.jsx(NMs,{variant:\"modal\"})")
// search backwards for KA=
let region = text.slice(anchor - 15000, anchor)
const matches = [...region.matchAll(/[,;\s]KA=([^,;]{1,80})/g)]
console.log("KA assignments near ozs:")
for (const m of matches.slice(-10)) {
  console.log(m[0], "@", m.index)
}
// also look for let KA
const kaLet = [...region.matchAll(/let KA[=,]/g)]
console.log("let KA", kaLet.map(m => region.slice(m.index, m.index+120)))

// IW store active - typing
console.log("\n--- IW / prompt active ---")
const iw = text.indexOf("IW={active:")
console.log(text.slice(iw, iw+400).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))
const iw2 = text.indexOf("active:!0")
// find setActive for typing
const zwn = text.indexOf("function Zwn()")
console.log(text.slice(zwn-500, zwn+200).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))
