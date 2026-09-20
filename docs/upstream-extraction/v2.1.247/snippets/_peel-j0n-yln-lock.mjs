import { readFileSync, writeFileSync } from 'fs'

const outDir = 'docs/upstream-extraction/v2.1.247/snippets'
const buf = readFileSync(
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe',
)

function asciiWindow(start, end) {
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
  return s.replace(/[.]{4,}/g, '...')
}

function extractFn(start) {
  let i = start
  while (i < buf.length && buf[i] !== 123) i++
  if (i >= buf.length) return { start, end: start, text: '' }
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
        return { start, end: i + 1, text: asciiWindow(start, i + 1) }
      }
    }
  }
  return { start, end: start + 200, text: asciiWindow(start, start + 200) }
}

function dump(name, content) {
  writeFileSync(`${outDir}/${name}`, content)
}

const TB = extractFn(214573412)
const j0n = extractFn(214574841)
const N0n = extractFn(214573520)
const IR = extractFn(214577454)
const GSt = extractFn(214571162)
const yln = extractFn(213648410)
const sme = extractFn(214568775)

dump(
  'gold-j0n-TB-full.txt',
  `# LOCKED TB @214573412 end=${TB.end} len=${TB.end - 214573412}
# unique string XX("installed",Fs()) count=1
# unique callers: ame@214576324 let n=TB(t); N0n@214573520 let n=TB(t)
# name collision function TB( count=3 — other hits are no-arg (autoUpload @208743048, React @248864378)
# alias: none for THIS TB (same-module as ame/_0n). TB as mvc is the other TB (go neighbor). TB as ur/fi/XP/W/Ke is _255.js.
${TB.text}
`,
)

dump(
  'gold-j0n-j0n-full.txt',
  `# LOCKED j0n @214574841 end=${j0n.end} len=${j0n.end - 214574841}
# unique async function j0n( count=1
# unique caller ame@214576324 return j0n(t,n,e) count=1
# unique string Saved \${Object.keys(r.written.plugins).length} installed plugins through the storage interface count=1
# alias: none (j0n as / as j0n count=0). same-module as ame.
${j0n.text}
`,
)

dump(
  'gold-j0n-N0n-full.txt',
  `# LOCKED N0n @214573520 end=${N0n.end} len=${N0n.end - 214573520}
# unique async function N0n(e,t) count=1
# unique callers: ame@214576437 await N0n(r) 1-arg; also @214589142 await N0n({version:2,plugins:m},e) 2-arg
# unique string Failed to save installed_plugins.json to @214573954 (string-table twin @201644408)
# alias: none (N0n as / as N0n count=0). same-module as ame.
${N0n.text}
`,
)

dump(
  'gold-j0n-IR-full.txt',
  `# LOCKED IR @214577454 end=${IR.end} len=${IR.end - 214577454}
# name collision function IR( count=6 — bind via unique string + unique caller
# unique string function IR(){try{let e=GSt() count=1
# unique caller ame@214576408 let r=IR() count=1
# export: IR as Yea @219687673 (same map as eUe/mHa/sZ/O0n/H0n/yB/gHa)
# import: Yea as Ge @222874759 (with baa as Ft = dPe)
# other IR as Et is _412.js — not this
${IR.text}

# unique callee GSt @214571162 end=${GSt.end} len=${GSt.end - 214571162}
# function GSt(){ count=1 — disk read sme()=vB(Fs(),"installed_plugins.json")
${GSt.text}

# unique sme @214568775
${sme.text}
`,
)

dump(
  'gold-yln-yln-full.txt',
  `# LOCKED yln @213648410 end=${yln.end} len=${yln.end - 213648410}
# unique function yln( count=1 in official-247 (239 Select yln is gone/renamed)
# unique string function yln(e){let{pendingUsage:t}=HP() count=1
# unique caller dPe@213653132 yln(n),ki( count=1
# alias: none (yln as / as yln count=0). same-module as dPe.
# dPe export: dPe as baa @219684806. import baa as Ft @222874809.
${yln.text}
`,
)

console.log('TB', TB.end - 214573412, TB.text)
console.log('j0n', j0n.end - 214574841, j0n.text)
console.log('N0n', N0n.end - 214573520, N0n.text)
console.log('IR', IR.end - 214577454, IR.text)
console.log('GSt', GSt.end - 214571162, GSt.text)
console.log('sme', sme.end - 214568775, sme.text)
console.log('yln', yln.end - 213648410, yln.text)
