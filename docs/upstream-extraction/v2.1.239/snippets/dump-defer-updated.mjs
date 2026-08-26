import { readFileSync, writeFileSync } from 'node:fs'

const exe = process.env.TEMP + '\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)

function around(i, b, a) {
  const sl = buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a))
  let s = ''
  for (const c of sl) s += c >= 32 && c < 127 ? String.fromCharCode(c) : '.'
  return s
}

const needles = [
  'toolInput:w',
  'hookUpdatedInput',
  'permissionBehavior==="allow"||u.permissionBehavior==="ask"',
  'permissionBehavior==="allow"',
  'type:"defer"',
  'case"defer":u.permissionBehavior="defer"',
]

let out = ''
for (const n of needles) {
  const needle = Buffer.from(n)
  const offs = []
  let i = 0
  while (offs.length < 4) {
    const j = buf.indexOf(needle, i)
    if (j < 0) break
    offs.push(j)
    i = j + 1
  }
  out += `\n==== ${JSON.stringify(n)} hits=${offs.length} ====\n`
  for (const o of offs.slice(0, 2)) {
    out += `@${o}:\n${around(o, 400, 900)}\n\n`
  }
}

writeFileSync(new URL('./gold-defer-updated.txt', import.meta.url), out, 'utf8')
console.log('wrote', out.length)
