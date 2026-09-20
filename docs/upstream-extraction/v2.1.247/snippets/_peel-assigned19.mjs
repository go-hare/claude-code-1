import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sea = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const buf = readFileSync(sea)
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

function asciiWindow(pos, before, after, name) {
  const start = Math.max(0, pos - before)
  const end = Math.min(buf.length, pos + after)
  const raw = buf.subarray(start, end)
  let s = ''
  for (const b of raw) s += b >= 32 && b < 127 ? String.fromCharCode(b) : (b === 10 ? '\n' : (b === 13 ? '\r' : '.'))
  writeFileSync(join(outDir, name), `# pos=${pos}\n${s}\n`)
}

asciiWindow(223571905, 800, 2000, 'gold-19-e-ne-unknown.txt')
asciiWindow(212687959, 400, 800, 'gold-19-e-ne-unknown-2.txt')

// chunk imports before Q$
asciiWindow(208397180, 0, 4000, 'gold-22-chunk0-imports.txt')

// dump official removeFreshCopyUnlessInUse export site + search function
const needles = ['function k(e,t)', 'async function k(', 'removeFreshCopyUnlessInUse']
for (const n of needles) {
  let p = 223000000
  let k = 0
  while (k < 3) {
    const i = buf.indexOf(Buffer.from(n, 'ascii'), p)
    if (i < 0 || i > 223500000) break
    console.log(n, i)
    asciiWindow(i, 100, 1500, `gold-19-k-${n.replace(/\W+/g,'_')}-${k}.txt`)
    k++
    p = i + n.length
  }
}
