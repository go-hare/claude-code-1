import { readFileSync, existsSync } from 'node:fs'

const sea247 = 'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const sea246 = 'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'
const buf = readFileSync(sea247)
const buf246 = existsSync(sea246) ? readFileSync(sea246) : null

function count(bufx, s) {
  let n = 0, p = 0
  const needle = Buffer.from(s, 'ascii')
  while (true) {
    const i = bufx.indexOf(needle, p)
    if (i < 0) break
    n++
    p = i + needle.length
  }
  return n
}

for (const s of [
  'id:"preflight"',
  'id:"preflight",component',
  'Unable to connect to Anthropic services',
  'function Q$(){',
  'function Z$(){',
  'Ae()||Ie()',
]) {
  const a = count(buf, s)
  const b = buf246 ? count(buf246, s) : -1
  console.log(`247=${a} 246=${b}`, JSON.stringify(s))
}
