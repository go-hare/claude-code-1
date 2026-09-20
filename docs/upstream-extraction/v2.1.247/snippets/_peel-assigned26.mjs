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

const needles = [
  'escape-safe',
  'escapeSafe',
  'safePluginText',
  'marketplace text',
  'stripInvisible',
  'oscEscape',
  'ansiSafe',
  'safeDisplay',
  'formatMarketplace',
  '\\p{Cc}',
  'Default_Ignorable',
  'pluginVersionHasLiveUsers',
  'in use by another',
  'deferring overwrite',
  'workingTreeDiff',
  'reportWorkingTree',
  'cwd_status',
]
for (const n of needles) {
  const a = count(buf, n)
  const b = buf246 ? count(buf246, n) : -1
  if (a !== b) console.log(`DIFF 247=${a} 246=${b}`, JSON.stringify(n))
  else if (a > 0) console.log(`same ${a}`, JSON.stringify(n))
}
