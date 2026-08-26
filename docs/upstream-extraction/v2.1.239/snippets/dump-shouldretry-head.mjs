import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const i = 310736900
const out =
  `\n==== shouldRetry around extra usage ====\n` +
  printable(buf.slice(i, i + 1600).toString('utf8')) +
  `\n\n==== BedrockUnexpectedContentType 306408059 ====\n` +
  printable(buf.slice(306408059 - 200, 306408059 + 900).toString('utf8')) +
  `\n\n==== BedrockUnexpectedContentType 306956182 ====\n` +
  printable(buf.slice(306956182 - 200, 306956182 + 900).toString('utf8')) +
  `\n\n==== BedrockUnexpectedContentType 306956750 ====\n` +
  printable(buf.slice(306956750 - 200, 306956750 + 700).toString('utf8'))

writeFileSync(new URL('./gold-shouldretry-head.txt', import.meta.url), out)
console.log('ok')
