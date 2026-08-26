import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

function sliceAround(kw, before = 80, after = 900) {
  const i = buf.indexOf(Buffer.from(kw))
  if (i < 0) return `MISS ${kw}\n`
  return `==== ${kw} @${i} ====\n${printable(buf.slice(Math.max(0, i - before), i + after).toString('utf8'))}\n`
}

const out = [
  sliceAround('deleteToLineStart(){', 0, 500),
  sliceAround('deleteToLineEnd(){', 0, 400),
  sliceAround('SDK major-version upgrade guides', 200, 800),
  sliceAround('# Live Documentation Sources', 0, 600),
  sliceAround('until your limit resets', 200, 400),
  sliceAround("Remote Control isn't enabled for this account", 0, 400),
  sliceAround('Please restart Claude from an existing directory', 200, 500),
  sliceAround('nextWord(){if(this.isAtEnd())', 0, 400),
].join('\n')

writeFileSync(new URL('./gold-more-239b.txt', import.meta.url), out)
console.log('ok', out.length)
