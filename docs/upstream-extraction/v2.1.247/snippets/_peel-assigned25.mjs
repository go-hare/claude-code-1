import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const sea247 = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const sea246 = 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'
const buf247 = readFileSync(sea247)
const buf246 = existsSync(sea246) ? readFileSync(sea246) : null
const outDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

function asciiWindow(bufx, pos, before, after, name) {
  const start = Math.max(0, pos - before)
  const end = Math.min(bufx.length, pos + after)
  const raw = bufx.subarray(start, end)
  let s = ''
  for (const b of raw) s += b >= 32 && b < 127 ? String.fromCharCode(b) : (b === 10 ? '\n' : (b === 13 ? '\r' : '.'))
  writeFileSync(join(outDir, name), `# pos=${pos}\n${s}\n`)
}

function idx(bufx, s) {
  return bufx.indexOf(Buffer.from(s, 'ascii'))
}

if (buf246) {
  const p = idx(buf246, 'id:"preflight"')
  console.log('246 preflight', p)
  if (p >= 0) asciiWindow(buf246, p, 400, 200, 'gold-22-246-preflight.txt')
}

const p247 = idx(buf247, 'id:"preflight"')
console.log('247 preflight', p247)
asciiWindow(buf247, p247, 400, 200, 'gold-22-247-preflight.txt')
