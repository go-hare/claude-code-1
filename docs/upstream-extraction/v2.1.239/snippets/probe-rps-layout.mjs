import { readFileSync, writeFileSync } from "fs"
const exe = "D:/work/py/claude/claude-code/.tmp-official-239-pkg/package/claude.exe"
const text = readFileSync(exe).toString("latin1")

// Fullscreen layout component starting at modal:fCt around 321285483
const start = 321285200
const chunk = text.slice(start, start + 8000).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ".")
writeFileSync("docs/upstream-extraction/v2.1.239/snippets/gold-fullscreen-modal-layout.txt", chunk)
console.log(chunk.slice(0, 4000))
console.log("\n--- cont ---\n")
console.log(chunk.slice(4000, 8000))
