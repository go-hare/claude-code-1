import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function dumpAt(label, i, before = 120, after = 900) {
  if (i < 0 || i == null) return `\n==== ${label} MISS ====\n`
  return (
    `\n==== ${label} ${i} ====\n` +
    printable(buf.slice(Math.max(0, i - before), i + after).toString('utf8')) +
    '\n'
  )
}

function findAll(needle, max = 8) {
  const hits = []
  let i = 0
  const n = Buffer.from(needle)
  while (hits.length < max) {
    i = buf.indexOf(n, i)
    if (i < 0) break
    hits.push(i)
    i += n.length
  }
  return hits
}

let out = ''
out += dumpAt('startsWith ./ @305468637', 305468637)
out += dumpAt('startsWith ./ @310151789', 310151789)
out += dumpAt('startsWith ./ @320468217', 320468217)
out += dumpAt('WATCHDOG JS @301321502', 301321502)
out += dumpAt('WATCHDOG JS @310726389', 310726389)
out += dumpAt('no agent named JS @313694772', 313694772)
out += dumpAt('no agent named JS @321115719', 321115719)
out += dumpAt('eventstream JS @302910977', 302910977)
out += dumpAt('Working dir JS @309978589', 309978589)
out += dumpAt('voiceEnabled JS @302040603', 302040603)
out += dumpAt('voiceEnabled JS @316284441', 316284441)

for (const kw of [
  'this session is named',
  'this agent is named',
  'your own name',
  'You are ',
  '(untitled)',
  'title.startsWith("/")',
  'startsWith("/")&&',
  'charCodeAt(0)===47',
  'stripLeadingSlash',
  'if(e[0]==="/")',
  'if(t[0]==="/")',
  'directoryCompletion',
  'completeDirectory',
  'shell completion',
  'function bew(',
  'function Zle(',
  'WATCHDOG',
  'retryWatchdog',
]) {
  const hits = findAll(kw)
  out += `\n#### ${JSON.stringify(kw)} ${hits.length} ${hits.join(',')}\n`
  if (hits[0] !== undefined) out += dumpAt(kw, hits[0], 80, 600)
}

writeFileSync(new URL('./gold-unknown-round3.txt', import.meta.url), out)
console.log('ok', out.length)
