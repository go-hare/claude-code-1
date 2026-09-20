import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const buf246 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
)

function asciiWindow(buf, start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s.replace(/[.]{4,}/g, '...')
}

function dump(tag, needle, before, after, which = 0, source = buf) {
  const n = Buffer.from(needle)
  let i = -1
  let from = 0
  let hit = 0
  while (true) {
    const j = source.indexOf(n, from)
    if (j < 0) break
    if (hit === which) {
      i = j
      break
    }
    hit++
    from = j + n.length
  }
  if (i < 0) {
    console.log('MISS', tag, JSON.stringify(needle))
    return
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-js4-${tag}.txt`,
    `# offset=${i} needle=${JSON.stringify(needle)}\n\n${asciiWindow(source, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', tag, i)
}

function count(source, needle) {
  const n = Buffer.from(needle)
  let c = 0
  let i = 0
  while (c < 20) {
    const j = source.indexOf(n, i)
    if (j < 0) break
    c++
    i = j + n.length
  }
  return c
}

const needles = [
  'var RTe=',
  'RTe="',
  'RTe=`',
  ',RTe=',
  'var hlo=',
  ',hlo=',
  'hlo=',
  'function lK(',
  'apiErrorStatus=',
  'mainThreadAgentDefinition:void 0',
]

console.log('=== 247 ===')
for (const n of needles) console.log(count(buf, n), n)
console.log('=== 246 void0 ===')
console.log(count(buf246, 'mainThreadAgentDefinition:void 0'))

dump('RTe-assign', ',RTe=', 200, 400)
dump('hlo-assign', ',hlo=', 200, 400)
dump('hlo-assign2', 'hlo=', 200, 400)
dump('lK-fn', 'function lK(', 200, 800)
dump('api-status-assign', 'apiErrorStatus=', 1500, 1500)
dump('void0-246-0', 'mainThreadAgentDefinition:void 0', 600, 800, 0, buf246)
dump('void0-246-1', 'mainThreadAgentDefinition:void 0', 600, 800, 1, buf246)
dump('void0-247', 'mainThreadAgentDefinition:void 0', 800, 800, 0, buf)
