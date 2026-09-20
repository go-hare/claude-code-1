import { existsSync, readFileSync, writeFileSync } from 'fs'

const p247 =
  'C:/Users/Administrator/AppData/Local/Temp/official-247/package/claude.exe'
const p246 =
  'C:/Users/Administrator/AppData/Local/Temp/official-246/package/claude.exe'

function allHits(buf, needle) {
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

function dumpAt(buf, name, offset, before, after, extra = '') {
  const s = asciiWindow(buf, Math.max(0, offset - before), offset + after)
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${offset} ${extra}\n\n${s}\n`,
  )
  console.log('OK', name, offset, s.length)
}

const b247 = readFileSync(p247)
const b246 = existsSync(p246) ? readFileSync(p246) : null
console.log('loaded', b247.length, b246?.length)

const needles = [
  'flushedEscapePrefix',
  'function kD(',
  'function kD()',
  'mailto:',
  'd0l(',
  'function d0l',
  'function jG',
  'case"link":',
  'sW.workflow',
  'V8c.workflow',
  'bash_permission_prompt_upsell',
  'workflow_permission_prompt',
  'canOfferAutoMode',
  'function jw(',
  'matchedAskRule',
  'enableAutoModeDescription',
  'var RA=',
  'RA=',
  'applyEdits',
  'jsonc',
  'vscode-json',
  'function te(',
  'function he(',
  'function ee(',
  'function q(',
  'base-layout',
  ':base',
  'split(":")',
  'parts[2]',
  'e[1].split',
  'Ctrl+',
  'mods.ctrl',
  'settings.json symlink',
  'lstatSync',
  'readlinkSync',
  'unlinkSync',
  'denyWrite.push',
  'getSettingsFilePathForSource',
  'isSafeHyperlink',
  'unsafeHref',
  'network-shaped',
  'isUncOrNt',
  'automount',
  '/net/',
  'file:///',
  'plain text',
  'supportsHyperlinks',
  'OSC 8',
  ']8;;',
]

console.log('\n==== extra counts ====')
for (const n of needles) {
  const a = b246 ? allHits(b246, n).length : -1
  const b = allHits(b247, n).length
  if (a > 0 || b > 0) {
    console.log(`${a !== b ? 'DIFF' : 'same'} ${a}->${b} ${JSON.stringify(n)}`)
  }
}

// #10 full qb + state
const flushJs = allHits(b247, 'function qb(e,o=""){let i=o===null')
console.log('qb 247', flushJs)
if (flushJs[0]) dumpAt(b247, 'gold-10-qb-full.txt', flushJs[0], 200, 4500, 'qb 247')
if (b246) {
  const qb246 = allHits(b246, 'function qb(e,o=""){let i=o===null')
  console.log('qb 246', qb246)
  if (qb246[0]) dumpAt(b246, 'gold246-10-qb-full.txt', qb246[0], 200, 4500, 'qb 246')
}

const flushedState = allHits(b247, 'flushedEscapePrefix:')
console.log('flushedEscapePrefix: hits', flushedState)
for (let i = 0; i < Math.min(flushedState.length, 4); i++) {
  dumpAt(b247, `gold-10-state-${i}.txt`, flushedState[i], 800, 800, `hit ${i}`)
}

// #3 wiring
const upsell = allHits(b247, 'bash_permission_prompt_upsell')
console.log('upsell', upsell)
if (upsell[0]) dumpAt(b247, 'gold-3-upsell.txt', upsell[0], 2500, 2500)

const sw = allHits(b247, 'sW.workflow')
if (sw[0]) dumpAt(b247, 'gold-3-sw.txt', sw[0], 1500, 800)

const une = allHits(b247, 'var UNe=')
if (une[0]) dumpAt(b247, 'gold-3-une-full.txt', une[0], 400, 200)

// jw / canOffer
const canOffer = allHits(b247, 'canOfferAutoMode')
console.log('canOfferAutoMode', canOffer)
for (let i = 0; i < Math.min(canOffer.length, 5); i++) {
  dumpAt(b247, `gold-3-canOffer-${i}.txt`, canOffer[i], 1500, 1500, `hit ${i}`)
}

// #12 jsonc helpers near ut
const me = allHits(b247, 'function me(t){return T(t)&&t.context==="Terminal"')
if (me[0]) dumpAt(b247, 'gold-12-ut-full.txt', me[0], 200, 3500)

const allowTrail = allHits(b247, 'allowTrailingComma:!0')
console.log('allowTrailingComma', allowTrail)
for (const off of allowTrail.slice(0, 3)) {
  dumpAt(b247, `gold-12-jsonc-${allowTrail.indexOf(off)}.txt`, off, 2000, 1500)
}

// #29 markdown link
for (const n of [
  'mailto:',
  'd0l(',
  'function d0l',
  'case"link":',
  ']8;;',
  'supportsHyperlinks',
]) {
  const hits = allHits(b247, n)
  console.log('29', JSON.stringify(n), hits.length, hits.slice(0, 4).join(','))
}

const mailto = allHits(b247, 'Prevent mailto')
const mailto2 = allHits(b247, 'mailto:')
console.log('Prevent mailto', mailto.length)
// find mailto near function-looking
let dumpedMailto = 0
for (const off of mailto2) {
  const s = asciiWindow(b247, Math.max(0, off - 200), off + 400)
  if (s.includes('case') && (s.includes('link') || s.includes('href'))) {
    dumpAt(b247, `gold-29-mailto-${dumpedMailto}.txt`, off, 1500, 2500)
    dumpedMailto++
    if (dumpedMailto >= 3) break
  }
}

// #11 kD cleanup
const kd = allHits(b247, 'cleanupAfterCommand:kD')
console.log('cleanupAfterCommand:kD', kd)
if (kd[0]) dumpAt(b247, 'gold-11-kD-ref.txt', kd[0], 500, 200)

const kdFn = allHits(b247, 'function kD(')
console.log('function kD(', kdFn)
for (const off of kdFn.slice(0, 3)) {
  dumpAt(b247, `gold-11-kD-${kdFn.indexOf(off)}.txt`, off, 200, 2500)
}

// settings path cleanup
const settingsSrc = allHits(b247, 'getSettingsFilePathForSource')
console.log('getSettingsFilePathForSource', settingsSrc.length)
for (let i = 0; i < Math.min(settingsSrc.length, 4); i++) {
  const off = settingsSrc[i]
  const s = asciiWindow(b247, Math.max(0, off - 400), off + 800)
  if (s.includes('function') || s.includes('isSymbolicLink') || s.includes('lstat')) {
    dumpAt(b247, `gold-11-settings-${i}.txt`, off, 1500, 2000, 'js-ish')
  }
}

// #9 CSI u parse — look near traditionalCtrl / decodeModifier
const zb = allHits(b247, 'function zb(')
console.log('function zb(', zb)
const trad = allHits(b247, 'function zb(e,o){if(!(e.ctrl&&e.meta)')
console.log('altgr zb', trad)

// search for CSI u parse function - keycode 57399 nearby parse
const kp = allHits(b247, 'case 57399:')
console.log('case 57399', kp)
if (kp[0]) dumpAt(b247, 'gold-9-kp.txt', kp[0], 2500, 2500)

const csiu = allHits(b247, 'ESC[')
console.log('need better kitty needle')

// split(":") in parse key area - search unique CSI u regex
for (const n of [
  'unicode-key-code',
  'CSI u',
  '[\\d:]+',
  'mods.ctrl',
  'e.ctrl=!0',
  'ctrl:!0',
]) {
  const h = allHits(b247, n)
  const h6 = b246 ? allHits(b246, n).length : -1
  if (h.length || h6) console.log('9', JSON.stringify(n), h6, '->', h.length)
}
