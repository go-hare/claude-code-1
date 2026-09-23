/**
 * Append UNKNOWN residuals section to gold-248-fGt-full.txt
 */
import { readFileSync, writeFileSync } from 'fs'

const p =
  'docs/upstream-extraction/v2.1.248/snippets/gold-248-fGt-full.txt'
let s = readFileSync(p, 'utf8')
if (!s.includes('## UNKNOWN residuals')) {
  s += `
## UNKNOWN residuals (after full peel)
- D() @178167129 — PEELABLE; leftover isHoverRestOn / settingsPrimerGate wires it (sha D=394b34757d9d45d8, rtr @178167156 sha=701bf9660a0067b0).
- primer / SKn @179523748 — class body NOT landed into SettingsOwner; assign e.primer=new SKn(t,e) @179527321 via settingsPrime ($pn).
- Retain gate call @178505949: userLayer==="retain"&&D()&&this.primer!==void 0
- primedFolderListing D() call @178507118; folderListingForPolicyWalk @178507193; noteWalkListing @178507366
`
  writeFileSync(p, s)
  console.log('appended UNKNOWN residuals')
} else {
  console.log('already present')
}
