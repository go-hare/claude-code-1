import { readFileSync, writeFileSync } from 'node:fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-239/package/claude.exe',
)

function printable(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g, '.')
}

const i = buf.indexOf(
  Buffer.from('your ${y.limitName} resets ${y.resetTime}'),
)
const i2 = buf.indexOf(Buffer.from('function Kvi('))
const i3 = buf.lastIndexOf(Buffer.from('function Kvi('), 310_000_000)
const i4 = buf.indexOf(Buffer.from('Kvi(e)'))

const pieces = []
for (const [label, off] of [
  ['template', i],
  ['function Kvi', i2],
  ['Kvi call', i4],
]) {
  pieces.push(
    `\n==== ${label} ${off} ====\n` +
      (off < 0
        ? 'MISS'
        : printable(buf.slice(Math.max(0, off - 400), off + 900).toString('utf8'))),
  )
}

// Also hunt nearby helpers
for (const kw of [
  'limitName:"session limit"',
  'limitName:"weekly limit"',
  'five_hour',
  'seven_day',
]) {
  let o = buf.indexOf(Buffer.from(kw), 300_000_000)
  pieces.push(
    `\n==== ${kw} ${o} ====\n` +
      (o < 0
        ? 'MISS'
        : printable(buf.slice(o - 200, o + 500).toString('utf8'))),
  )
}

writeFileSync(new URL('./gold-kvi.txt', import.meta.url), pieces.join('\n'))
console.log({ i, i2, i4 })
