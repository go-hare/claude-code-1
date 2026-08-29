import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const candidates = [
  process.env.CLAUDE_SEA_239,
  join(process.env.TEMP || "", "official-239", "package", "claude.exe"),
  "bin/claude.exe",
].filter(Boolean)

let exe = null
for (const c of candidates) {
  try { readFileSync(c); exe = c; break } catch {}
}
if (!exe) { console.error("no SEA"); process.exit(1) }
const text = readFileSync(exe).toString("latin1")
console.log("SEA", exe, "len", text.length)

function dump(needle, before=200, after=500, max=5) {
  let from = 0, n = 0
  while (n < max) {
    const i = text.indexOf(needle, from)
    if (i < 0) break
    console.log(`\n=== hit ${n} @${i} ===`)
    console.log(text.slice(Math.max(0,i-before), i+after).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "."))
    from = i + needle.length
    n++
  }
  if (n === 0) console.log("no hits for", JSON.stringify(needle))
}

dump('?"none":t!==null?"suppressed":"visible"', 300, 80)
dump("function RPs", 20, 400)
dump('visible:wi==="visible"', 250, 200)
dump("visible:wi===", 250, 200)
dump("RPs()===", 100, 150, 8)
