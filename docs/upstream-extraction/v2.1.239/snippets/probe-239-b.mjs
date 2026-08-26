#!/usr/bin/env node
import { readFileSync } from 'node:fs'

const BIN = String.raw`C:\Users\Administrator\AppData\Local\Temp\official-239\package\claude.exe`
const buf = readFileSync(BIN)
const needles = [
  'synced',
  'US-only',
  'us_only',
  'usOnly',
  'inference premium',
  'residencyPremium',
  'usInference',
  'fullscreen offer',
  'renderer offer',
  'tuiOffer',
  'offerShown',
  'utf8bom',
  'utf-8-bom',
  'mouse report',
  'working directory does not exist',
  'Current directory does not exist',
  'no longer exists. Please',
  'named pipe',
  'teammate',
  'own name',
  '(untitled)',
  'Pasted text',
  'double Esc',
  'org policy',
  'worktreeConfig',
  'claude plugin enable',
  'from claude.ai',
  'cloud plugin',
  'syncedFromCloud',
  'pluginSource',
  'source:"synced"',
  "source:'synced'",
  'source:"cloud"',
  'US_INFERENCE',
  'us_inference',
  'inference_multiplier',
  'costMultiplier',
  '1.1',
  'eleven tenths',
  '110%',
]
for (const kw of needles) {
  const needle = Buffer.from(kw, 'utf8')
  let c = 0
  let from = 0
  while (c < 30) {
    const i = buf.indexOf(needle, from)
    if (i < 0) break
    c++
    from = i + needle.length
  }
  console.log(`${String(c).padStart(3)}  ${JSON.stringify(kw)}`)
}
