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

function dump(name, i, before, after) {
  writeFileSync(
    `docs/upstream-extraction/v2.1.247/snippets/${name}`,
    `# offset=${i}\n\n${asciiWindow(buf, Math.max(0, i - before), i + after)}\n`,
  )
  console.log('OK', name, i)
}

const hydF = buf.indexOf(Buffer.from('Hyd as F,Nyd as Ce'), 211415952)
dump('gold-dig-tI-Hyd-as-F.txt', hydF, 20, 80)

const hydYe = buf.indexOf(Buffer.from('Hyd as ye,Iyd as Ar'), 212803258)
dump('gold-dig-Ar-Hyd-Iyd-import.txt', hydYe, 40, 80)

const eob = buf.indexOf(Buffer.from('EOb as JT'), 212803258)
dump('gold-dig-JT-EOb-import.txt', eob, 40, 80)

const hfb = buf.indexOf(Buffer.from('hfb as tI'), 212803258)
dump('gold-dig-tI-hfb-import.txt', hfb, 40, 80)

// 844 named export object snippet
const named = buf.indexOf(Buffer.from('withTelemetryMessage:()=>z'))
dump('gold-dig-Ar-named-export.txt', named, 80, 40)

const namedYe = buf.indexOf(Buffer.from('TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS:()=>h'))
dump('gold-dig-tI-ye-named-export.txt', namedYe, 20, 40)
