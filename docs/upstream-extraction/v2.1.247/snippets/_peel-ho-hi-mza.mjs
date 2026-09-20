import { readFileSync, writeFileSync } from 'fs'

const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
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

function findAll(needle, limit = 20) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (hits.length < limit) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + 1
  }
  return hits
}

function dump(name, i, before, after) {
  const text = asciiWindow(buf, Math.max(0, i - before), i + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${text}\n`,
  )
  console.log('OK', name, i, 'len', text.length)
}

dump('gold-dig-ho-slice-210752939.txt', 210752800, 200, 800)

for (const n of [
  'function hi(e){',
  'function ho(e){if(e.includes("@"))',
  'function ho(e){if(e.includes("@")',
  'function hi(e){if(e.includes("@"))',
  'function hi(e){if(e.includes("@")',
  'marketplace:e.slice',
  '{name:e.slice(0',
  'async function mza(',
  'async function gza(',
  'function mza(',
  'function gza(',
]) {
  const hits = findAll(n, 10)
  console.log('\n===', n, hits)
  for (const i of hits) {
    const win = asciiWindow(buf, Math.max(0, i - 40), i + 220)
    console.log(' ', i, win.slice(0, 240).replace(/\n/g, ' '))
    if (
      n.includes('mza') ||
      n.includes('gza') ||
      n.includes('includes') ||
      n.includes('slice')
    ) {
      dump(
        `gold-dig-${n.replace(/[^A-Za-z0-9]/g, '_').slice(0, 24)}-${i}.txt`,
        i,
        80,
        1200,
      )
    }
  }
}

// marketplace module imports near NSt cluster
dump('gold-dig-mkt-imports-214500.txt', 214500000, 0, 2500)

// find ho import in marketplace chunk: look backward from NSt for import{...ho
const nst = 214556179
dump('gold-dig-before-NSt-import.txt', nst, 8000, 200)

// callers of NSt(, B$(, hza(, yza(, fza(, d2(
for (const n of [
  'await NSt(',
  'NSt(',
  'await B$(',
  'await hza(',
  'yza(',
  'await fza(',
  'await d2(',
]) {
  const hits = findAll(n, 15)
  console.log('\nCALL', n, hits)
  for (const i of hits) {
    if (i > 214500000 && i < 214580000) {
      console.log('  mkt', i, asciiWindow(buf, i, i + 80).replace(/\n/g, ' '))
    } else if (i > 200000000 && i < 220000000) {
      const win = asciiWindow(buf, i - 30, i + 90)
      if (
        win.includes('plugin') ||
        win.includes('marketplace') ||
        win.includes('storage') ||
        win.includes('Ne()')
      ) {
        console.log('  pin', i, win.slice(0, 140).replace(/\n/g, ' '))
      }
    }
  }
}

// qb factory / empty storage
for (const n of [
  'function qb(',
  'var qb=',
  'qb()',
  'FromEnv',
  'empty storage',
]) {
  const hits = findAll(n, 8)
  console.log('qb-ish', n, hits)
}
