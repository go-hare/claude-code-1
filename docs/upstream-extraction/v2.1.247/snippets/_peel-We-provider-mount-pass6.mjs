/**
 * Pass6: dump complete Pe (REPL→AppRoot) and Kc outer fn window.
 */
import { readFileSync, writeFileSync } from 'fs'

const buf247 = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function asciiWindow(buf, start, end) {
  let s = ''
  const a = Math.max(0, start)
  const b = Math.min(buf.length, end)
  for (let j = a; j < b; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function extractFn(buf, start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  let depth = 0
  let inS = 0
  let esc = false
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inS) {
      if (esc) {
        esc = false
        continue
      }
      if (c === 92) {
        esc = true
        continue
      }
      if (c === inS) inS = 0
      continue
    }
    if (c === 34 || c === 39 || c === 96) {
      inS = c
      continue
    }
    if (c === 123) depth++
    else if (c === 125) {
      depth--
      if (depth === 0) {
        return { start, end: i + 1, text: asciiWindow(buf, start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(buf, start, start + 200) }
}

function dump(name, text) {
  writeFileSync(`${outDir}/${name}`, text.endsWith('\n') ? text : `${text}\n`)
  console.log('WROTE', name)
}

const pe = buf247.indexOf(Buffer.from('async function Pe(r,t,a,V){'))
console.log('Pe @', pe)
if (pe >= 0) {
  const fn = extractFn(buf247, pe)
  console.log('Pe end', fn.end, 'len', fn.end - pe)
  dump(
    `gold-We-provider-mount-Pe-${pe}.txt`,
    `# Pe REPL→AppRoot @${pe} end=${fn.end} len=${fn.end - pe}\n${fn.text}\n`,
  )
  dump(
    'gold-We-provider-mount-Pe-neighbors.txt',
    `# around Pe @${pe}\n${asciiWindow(buf247, pe - 200, fn.end + 120)}\n`,
  )
}

// Xe alias
const xe = buf247.indexOf(Buffer.from('function Xe(...r){return Pe(...r)}'))
console.log('Xe @', xe)

// Kc larger window
dump(
  'gold-We-provider-mount-Kc-before-4k.txt',
  `# Kc agents-list @223847292\n${asciiWindow(buf247, 223844000, 223849200)}\n`,
)

console.log('ok')
