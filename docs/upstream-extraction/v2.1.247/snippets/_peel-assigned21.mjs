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

asciiWindow(208321701, 600, 400, 'gold-22-zgc-export.txt')

// also XGc and $Gc nearby
asciiWindow(208321600, 800, 800, 'gold-22-705-exports.txt')

// find _705.js chunk start
let p = 208321701
for (let i = 0; i < 2; i++) {
  const j = buf.lastIndexOf(Buffer.from('// Version: 2.1.247'), p - 1)
  console.log('chunk', j)
  if (j < 0) break
  asciiWindow(j, 0, 1500, `gold-22-705-chunk-${i}.txt`)
  p = j
}
