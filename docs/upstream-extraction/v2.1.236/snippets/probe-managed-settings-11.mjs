import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const exe =
  process.env.CLAUDE_SEA ||
  process.env.TEMP + '\\official-239\\package\\claude.exe'
const buf = readFileSync(exe)
const scrub = s => s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '.')

function hits(needle, max = 40) {
  const nb = Buffer.from(needle)
  const out = []
  let i = 0
  for (;;) {
    const k = buf.indexOf(nb, i)
    if (k === -1) break
    out.push(k)
    i = k + 1
    if (out.length >= max) break
  }
  return out
}

function dump(label, needle, before = 350, after = 900, max = 8, pred) {
  const ks = hits(needle, max * 3)
  const lines = [`## ${label} count=${hits(needle).length}`]
  let n = 0
  for (const k of ks) {
    const w = scrub(buf.subarray(Math.max(0, k - before), k + after).toString('latin1'))
    if (pred && !pred(w)) continue
    lines.push(`--- offs=${k} ---`)
    lines.push(w)
    n++
    if (n >= max) break
  }
  return lines.join('\n')
}

const parts = []
parts.push(`SEA=${exe} size=${buf.length}`)
parts.push(
  dump(
    'not yet approved in the managed-settings dialog',
    'not yet approved in the managed-settings dialog',
    200,
    600,
  ),
)
parts.push(dump('remote_consent_missing', 'remote_consent_missing', 200, 500))
parts.push(
  dump('hasActiveInkSurface', 'hasActiveInkSurface', 200, 800),
)
parts.push(dump('showSecurityDialog', 'showSecurityDialog', 250, 900, 10))
parts.push(
  dump('deferred_no_consent_surface', 'deferred_no_consent_surface', 200, 700),
)
parts.push(
  dump(
    'managed-settings dialog (nearby render/createRoot)',
    'managed-settings dialog',
    400,
    1000,
    6,
  ),
)
parts.push(
  dump(
    'loadRemoteManagedSettings-ish (waitForRemote)',
    'waitForRemoteManagedSettings',
    200,
    500,
    6,
  ),
)
parts.push(
  dump('Settings errors are currently blocking', 'Settings errors are currently blocking', 150, 400),
)
parts.push(
  dump(
    'eating first keypress-ish',
    'first keypress',
    100,
    300,
    5,
  ),
)

// Broader: functions that call security dialog + Ink
parts.push(
  dump(
    'ManagedSettingsSecurity / security dialog component strings',
    'Managed settings',
    200,
    700,
    8,
    w => /dialog|approv|consent|dangerous/i.test(w),
  ),
)

// Look for dual-render pattern: showSecurityDialog + createRoot / render
parts.push(
  dump(
    'YXd / checkManagedSettingsSecurity-ish',
    'deferred_non_interactive',
    400,
    1200,
    4,
  ),
)

const out = join(
  process.cwd(),
  'docs/upstream-extraction/v2.1.236/snippets/gold-managed-settings-11.txt',
)
writeFileSync(out, parts.join('\n\n'))
console.log('wrote', out)
console.log(
  Object.fromEntries(
    [
      'not yet approved in the managed-settings dialog',
      'remote_consent_missing',
      'hasActiveInkSurface',
      'showSecurityDialog',
      'deferred_no_consent_surface',
      'waitForRemoteManagedSettings',
      'Settings errors are currently blocking',
      'first keypress',
    ].map(n => [n, hits(n).length]),
  ),
)
