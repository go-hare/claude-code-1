import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const keys = [
  'var ebt=',
  'ebt=',
  'function $Wa(',
  'session limit',
  'Strip leading',
  'dirPortion.startsWith',
  'startsWith("./")',
  'charCodeAt(0)===65279',
  '.replace(/^\\uFEFF',
  'startsWith("/")',
  'untitled',
]

let out = ''
for (const kw of keys) {
  let i = buf.indexOf(Buffer.from(kw), 300_000_000)
  if (i < 0) i = buf.indexOf(Buffer.from(kw))
  out += `\n==== ${JSON.stringify(kw)} ${i} ====\n`
  if (i >= 0) out += printable(buf.slice(i, i + 600).toString('utf8')) + '\n'
}

writeFileSync(new URL('./gold-kvi-maps.txt', import.meta.url), out)
console.log('ok')
