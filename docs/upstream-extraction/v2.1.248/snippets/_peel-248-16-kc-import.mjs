import { EXE_248, loadSea, asciiSlice, extractFnAt } from './_peel-248-na-helpers.mjs'
const b = loadSea(EXE_248)
const start = 192110000
const end = 192131000
const win = asciiSlice(b, start, end)
for (const n of [',KC,', '{KC}', 'KC}', 'KC,', ' KC=']) {
  let i = 0
  while (true) {
    const k = win.indexOf(n, i)
    if (k < 0) break
    console.log(n, start + k, win.slice(Math.max(0, k - 30), k + 40))
    i = k + n.length
  }
}

const sjt = 184555057
const ext = extractFnAt(b, sjt, 800)
console.log('SJt', ext.len, ext.body)

// Ao(EJt near V$n
const ao = b.lastIndexOf(Buffer.from('function Ao('), 184556749)
console.log('Ao before V$n', ao)
console.log(asciiSlice(b, ao, ao + 200))

// leftover seedWipPool mapper?
const ao2 = []
let i = 184540000
while (i < 184557000) {
  const k = b.indexOf(Buffer.from('function Ao('), i)
  if (k < 0 || k > 184557000) break
  ao2.push(k)
  i = k + 8
}
console.log('Ao in V$n neighborhood', ao2)
for (const k of ao2) console.log(k, asciiSlice(b, k, k + 180))
