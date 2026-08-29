import { readFileSync } from "fs"
const text = readFileSync("D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe").toString("latin1")
// yP factory
const i = text.indexOf("function yP(")
console.log("yP:", text.slice(i, i+400).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))
const j = text.indexOf("legacyDialogFocus=yP")
console.log("\ninit:", text.slice(j-80, j+120).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))
// _Zt assignment near uQc sync
const k = text.indexOf("mn.current=e$,ho.useLayoutEffect(()=>(uQc(e$??null)")
console.log("\nsync:", text.slice(k-200, k+250).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))
// what is e$ / _Zt
const t = text.indexOf("function _Zt")
console.log("\n_Zt:", text.slice(t, t+800).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"."))
