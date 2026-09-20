import { readFileSync, writeFileSync } from 'fs'

const bufs = {
  246: readFileSync(
    'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe',
  ),
  247: readFileSync(
    'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
  ),
}

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

function dumpAt(ver, tag, needle, before, after) {
  const buf = bufs[ver]
  const i = buf.indexOf(Buffer.from(needle))
  if (i < 0) {
    console.log('MISS', ver, tag)
    return
  }
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/gold-6-${tag}-${ver}.txt`,
    `# offset=${i} ver=${ver} needle=${JSON.stringify(needle)}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', ver, tag, i)
}

dumpAt(247, 'nav-full', 'getFocusedValue:Ne', 3500, 800)
dumpAt(246, 'nav-full', 'getFocusedValue:x', 3500, 800)
dumpAt(247, 'ri-fn', 'function ri(e,t){if(e===void 0)return', 80, 200)
dumpAt(246, 'yr-fn', 'function Yr(e,i){if(e===void 0)return', 80, 200)
dumpAt(247, 'xfv', 'x().focusedValue', 800, 400)
dumpAt(247, 'hcurr', 'h.current=void 0', 800, 600)
dumpAt(247, 'axe-fn', 'function axe(', 80, 4000)
dumpAt(246, 'axe-fn', 'function axe(', 80, 4000)
dumpAt(247, 'selectFocused-js', 'selectFocusedOption:', 800, 400)
dumpAt(246, 'selectFocused-js', 'selectFocusedOption:', 800, 400)
dumpAt(247, 'skills-js', 'title:"Skills"', 80, 3500)
dumpAt(246, 'skills-js', 'title:"Skills"', 80, 3500)
