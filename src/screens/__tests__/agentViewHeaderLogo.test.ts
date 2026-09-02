/**
 * Regression: AgentView header Clawd aligned to densable Od_/WB / XFa / LUt.
 * densable 2.1.211: !wpe && Ys>=70 && <KB/>; gap2 marginBottom1; path Ys-11-(model+3);
 * no host width wrapper; text col plain column; Esc=Tt one-shot; Ctrl+C=CJ.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/** Strip block/line comments so source-string asserts only see real code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const clawdSrc = stripComments(
  readFileSync(
    join(import.meta.dir, '../../components/LogoV2/Clawd.tsx'),
    'utf8',
  ),
)
const agentViewSrc = stripComments(
  readFileSync(join(import.meta.dir, '../AgentView.tsx'), 'utf8'),
)

describe('AgentView header logo / path layout', () => {
  test('Clawd standard root Box sets flexShrink={0} without fixed width (densable KB)', () => {
    expect(clawdSrc).toContain('CLAWD_WIDTH = 9')
    // densable: flexShrink:0 only — width clips Apple/standard glyph rows
    expect(clawdSrc).toMatch(/flexDirection="column"\s+flexShrink=\{0\}\s*>/)
    expect(clawdSrc).not.toMatch(
      /flexDirection="column"\s+flexShrink=\{0\}\s+width=\{CLAWD_WIDTH\}/,
    )
    // densable uses ThemedText theme keys, not BaseText raw colors
    expect(clawdSrc).toContain('color="clawd_body"')
    expect(clawdSrc).toContain('backgroundColor="clawd_background"')
    expect(clawdSrc).not.toContain('BaseText')
  })

  test('Apple Terminal path: center + flexShrink 0, no fixed width', () => {
    // densable _ta omits flexShrink, but Box default flexShrink:1 crushes the
    // Apple column in Fleet header into solid orange bars — keep flexShrink:0.
    expect(clawdSrc).toMatch(
      /flexDirection="column"\s+alignItems="center"\s+flexShrink=\{0\}/,
    )
    expect(clawdSrc).not.toMatch(
      /flexDirection="column"\s+alignItems="center"\s+flexShrink=\{0\}\s+width=/,
    )
    expect(clawdSrc).toContain("' '.repeat(7)")
    expect(clawdSrc).toMatch(/default:\s*' ▗ {3}▖ '/)
    // truecolor black pupils wash out on Apple; ansi:black keeps orange body
    expect(clawdSrc).toContain('color="ansi:black"')
    expect(clawdSrc).not.toMatch(
      /color="clawd_background"\s+backgroundColor="clawd_body"/,
    )
  })

  test('default/look poses keep densable 8-col row1 (empty r1R)', () => {
    // 239 Bwg: default/look r1R is "" (r1E is 6 cols). Do not pad r1R.
    expect(clawdSrc).toMatch(/default:\s*\{[^}]*r1R:\s*''/)
    expect(clawdSrc).toMatch(/'look-left':\s*\{[^}]*r1R:\s*''/)
    expect(clawdSrc).toMatch(/'look-right':\s*\{[^}]*r1R:\s*''/)
    expect(clawdSrc).not.toMatch(/r1R:\s*'▌/)
  })

  test('AgentView header matches densable Od_/WB / XFa / LUt exactly', () => {
    expect(agentViewSrc).toContain('renderModelName')
    expect(agentViewSrc).toContain('truncatePathMiddle')
    expect(agentViewSrc).toContain('pathBudget')
    expect(agentViewSrc).toContain('termWidth - 11')
    expect(agentViewSrc).not.toContain('termWidth - 15')
    // Header row MUST flexShrink={0}: parent flexGrow column would otherwise
    // crush 3-row Clawd + title when the session list is long (solid bars).
    // densable avoids this via ScrollBox; we pin natural header height.
    expect(agentViewSrc).toMatch(
      /marginBottom=\{1\} gap=\{2\} flexShrink=\{0\}>/,
    )
    expect(agentViewSrc).not.toMatch(/width=\{CLAWD_WIDTH\}/)
    // densable KOs job chrome: ❯ + icon + two spaces
    expect(agentViewSrc).toContain('\\u276F')
    expect(agentViewSrc).toContain("{'  '}")
    expect(agentViewSrc).toContain('fleetHeaderBudget')
    expect(agentViewSrc).toContain('fleetXfaListEstimate')
    // densable hosts KB directly — no width={CLAWD_WIDTH} wrapper
    expect(agentViewSrc).toContain(
      '!compactHeader && termWidth >= 70 && <Clawd',
    )
    expect(agentViewSrc).not.toMatch(/width=\{CLAWD_WIDTH\}/)
    expect(agentViewSrc).toContain('deriveStatsBand')
    expect(agentViewSrc).toContain('statsBlocked')
    expect(agentViewSrc).toContain('statsActive')
    expect(agentViewSrc).toContain('statsCompleted')
    expect(agentViewSrc).toContain('awaiting input')
    expect(agentViewSrc).toContain('fleetDoneFoldAt')
    // densable oxy: simpleView first row is newsession, homeIdx=0; zky stays grouped.
    expect(agentViewSrc).toContain('buildSimpleModeFlatRows')
    expect(agentViewSrc).toContain('isFleetSimpleViewEnabled')
    expect(agentViewSrc).toContain('simpleView ? 0')
    expect(agentViewSrc).toContain('if (simpleBuilt) return simpleBuilt.rows')
    expect(agentViewSrc).not.toMatch(/\$\{pinned\.length\} pinned/)
    expect(agentViewSrc).not.toMatch(/ready for review/)
    expect(agentViewSrc).toMatch(/<Text bold>Claude Code<\/Text>/)
    // densable: Esc cascade → handleEscExit (JH/Tt) → forceExit; Ctrl+C uses handleCtrlCDoublePress.
    // forceExit is not inlined next to key.escape (cascade clears dispatch/delete first).
    expect(agentViewSrc).toContain('handleCtrlCDoublePress')
    expect(agentViewSrc).toMatch(/key\.escape[\s\S]{0,800}handleEscExit\(\)/)
    expect(agentViewSrc).toMatch(/handleEscExit[\s\S]{0,400}forceExit\(/)
    expect(agentViewSrc).not.toContain('requestExit')
    // densable CJ fSg=800 — not 2000; no any-key disarm (only timeout / 2nd / forceExit)
    expect(agentViewSrc).toContain('FLEET_EXIT_ARM_MS')
    expect(agentViewSrc).not.toContain(', 2000)')
    expect(agentViewSrc).not.toMatch(
      /\/\/ Any non-Ctrl-C key[\s\S]{0,80}disarmExitArm/,
    )
    // Ctrl+C cancel of rename/group/reply/help/pending must not disarmExitArm
    // (arm → cancel mode → 2nd Ctrl+C should exit, not re-arm as triple).
    expect(agentViewSrc).toMatch(
      /viewMode === 'rename' \|\| viewMode === 'group'[\s\S]{0,200}setViewMode\('list'\)/,
    )
    expect(agentViewSrc).not.toMatch(
      /viewMode === 'rename'[\s\S]{0,120}disarmExitArm\(\)/,
    )
    expect(agentViewSrc).not.toMatch(
      /viewMode === 'reply'[\s\S]{0,80}disarmExitArm\(\)/,
    )
    expect(agentViewSrc).not.toMatch(/helpOpen[\s\S]{0,80}disarmExitArm\(\)/)
  })
})
