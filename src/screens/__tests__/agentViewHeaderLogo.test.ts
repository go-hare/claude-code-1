/**
 * Regression: AgentView header Clawd aligned to densable Od_/WB / XFa / LUt.
 * densable: !wpe && Ys>=70 && KB; gap2 marginBottom1; path Ys-11-(model+3);
 * stats always awaiting/working/completed; no header flexShrink; no minWidth.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const clawdSrc = readFileSync(
  join(import.meta.dir, '../../components/LogoV2/Clawd.tsx'),
  'utf8',
)
const agentViewSrc = readFileSync(
  join(import.meta.dir, '../AgentView.tsx'),
  'utf8',
)

describe('AgentView header logo / path layout', () => {
  test('Clawd standard root Box sets flexShrink={0} without fixed width (densable KB)', () => {
    expect(clawdSrc).toContain('CLAWD_WIDTH = 9')
    // densable: flexShrink:0 only — width clips Apple/standard glyph rows
    expect(clawdSrc).toMatch(
      /flexDirection="column"\s+flexShrink=\{0\}\s*>/,
    )
    expect(clawdSrc).not.toMatch(
      /flexDirection="column"\s+flexShrink=\{0\}\s+width=\{CLAWD_WIDTH\}/,
    )
  })

  test('Apple Terminal path: center only, no fixed width (densable _ta)', () => {
    expect(clawdSrc).toMatch(
      /flexDirection="column"\s+alignItems="center"\s*>/,
    )
    expect(clawdSrc).not.toMatch(
      /flexDirection="column"\s+alignItems="center"\s+flexShrink=\{0\}/,
    )
    expect(clawdSrc).toContain("' '.repeat(7)")
    expect(clawdSrc).toMatch(/default:\s*' ▗   ▖ '/)
    // truecolor black pupils wash out on Apple; ansi:black keeps orange body
    expect(clawdSrc).toContain('color="ansi:black"')
    expect(clawdSrc).not.toMatch(
      /color="clawd_background"\s+backgroundColor="clawd_body"/,
    )
  })

  test('default/look poses keep densable 8-col row1 (no r1R pad)', () => {
    // densable r1R is bare ▌ — trailing space pad was a local wrong fix
    expect(clawdSrc).toMatch(/default:\s*\{[^}]*r1R:\s*'▌'/)
    expect(clawdSrc).toMatch(/'look-left':\s*\{[^}]*r1R:\s*'▌'/)
    expect(clawdSrc).toMatch(/'look-right':\s*\{[^}]*r1R:\s*'▌'/)
    expect(clawdSrc).not.toMatch(/r1R:\s*'▌ '/)
  })

  test('AgentView header matches densable Od_/WB / XFa / LUt', () => {
    expect(agentViewSrc).toContain('renderModelName')
    expect(agentViewSrc).toContain('truncatePathMiddle')
    expect(agentViewSrc).toContain('pathBudget')
    // densable LUt: Ys-11-(model+3), not CondensedLogo 15
    expect(agentViewSrc).toContain('termWidth - 11')
    expect(agentViewSrc).not.toContain('termWidth - 15')
    // densable: no flexShrink on header row; no minWidth on text col
    expect(agentViewSrc).toMatch(/marginBottom=\{1\} gap=\{2\}>/)
    expect(agentViewSrc).not.toMatch(
      /marginBottom=\{1\} gap=\{2\} flexShrink=\{0\}/,
    )
    expect(agentViewSrc).toContain('fleetHeaderBudget')
    expect(agentViewSrc).toContain('fleetXfaListEstimate')
    expect(agentViewSrc).toContain('!compactHeader && termWidth >= 70 && <Clawd')
    // densable stats: RU via deriveStatsBand (O7e) — awaiting/working/completed
    expect(agentViewSrc).toContain('deriveStatsBand')
    expect(agentViewSrc).toContain('statsBlocked')
    expect(agentViewSrc).toContain('statsActive')
    expect(agentViewSrc).toContain('statsCompleted')
    expect(agentViewSrc).toContain('awaiting input')
    expect(agentViewSrc).toContain('fleetDoneFoldAt')
    expect(agentViewSrc).not.toMatch(/\$\{pinned\.length\} pinned/)
    expect(agentViewSrc).not.toMatch(/ready for review/)
    // densable title: bold without forced theme color
    expect(agentViewSrc).toMatch(/<Text bold>Claude Code<\/Text>/)
  })
})
