import { existsSync, readFileSync, writeFileSync } from 'fs'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
if (!existsSync(p247)) process.exit(1)
const buf = readFileSync(p247)
const outDir = 'docs/upstream-extraction/v2.1.247/snippets'

function ascii(start, end) {
  let s = ''
  for (let j = start; j < end && j < buf.length; j++) {
    const c = buf[j]
    s +=
      c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)
        ? String.fromCharCode(c)
        : '.'
  }
  return s
}

function allHits(needle) {
  const n = Buffer.from(needle)
  const hits = []
  let from = 0
  while (from < buf.length) {
    const i = buf.indexOf(n, from)
    if (i < 0) break
    hits.push(i)
    from = i + n.length
  }
  return hits
}

function dump(name, needle, before, after, which = 0) {
  const hits = allHits(needle)
  if (!hits.length) {
    console.log('MISS', name, JSON.stringify(needle))
    return
  }
  const i = hits[which] ?? hits[0]
  writeFileSync(
    `${outDir}/${name}`,
    `# offset=${i} hit=${which + 1}/${hits.length} needle=${JSON.stringify(needle)}\n\n${ascii(Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i, `${which + 1}/${hits.length}`)
}

// WZ helpers: look in sandbox range ~2103xxxxx
function hitsInRange(needle, lo, hi) {
  return allHits(needle).filter(i => i >= lo && i < hi)
}

const SB_LO = 210300000
const SB_HI = 210500000
for (const n of [
  'function Vm(',
  'function Ji(',
  'function Qi(',
  'Vm as',
  ',Vm,',
  '{Vm,',
  'function wv(',
  'function kv(',
  'wv=',
  'async function kv(',
]) {
  const hits = hitsInRange(n, SB_LO, SB_HI)
  console.log('SB', n, hits.slice(0, 8), 'count', hits.length)
}

dump('gold-11-fn-wv.txt', 'function wv(', 40, 800)
dump('gold-11-fn-kv.txt', 'function kv(', 40, 1200)
dump('gold-11-fn-wv-assign.txt', 'function wv(e,t,n,r)', 40, 600)
dump('gold-2-fn-Ie.txt', 'function Ie()', 40, 400)
dump('gold-2-fn-Lo.txt', 'function Lo(', 40, 800)
dump('gold-2-fn-Pe.txt', 'function Pe()', 40, 200)
dump('gold-2-advertisedCommand.txt', 'advertisedCommand:', 80, 200)
dump('gold-2-failedTipIds.txt', 'failedTipIds', 80, 200)
dump('gold-22-ri-body.txt', 'function ri(e){return e.filter((t)=>t.severity!=="warning")}', 20, 80)
