import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, test } from 'bun:test'
import { AGENT_TOOL_NAME } from '@claude-code/builtin-tools/tools/AgentTool/constants.js'
import { ARTIFACT_TOOL_NAME } from '@claude-code/builtin-tools/tools/ArtifactTool/prompt.js'
import { getCoordinatorAgents } from '../workerAgent.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.289 wrapable unique-English 1–2', () => {
  test('worker Scope fan-out bullet sits between commit-hash and Limit changes', () => {
    const prompt = getCoordinatorAgents()[0]!.getSystemPrompt!({
      toolUseContext: { options: {} as never },
    })
    const commit = 'Report the commit hash in your summary.'
    const fan =
      "you may use it to fan out (e.g. `/simplify`, `/code-review`, or your own parallel research/verification) — workers at the depth cap don't receive it"
    const limit = '- Limit changes to what your task requires'
    expect(prompt).toContain(commit)
    if (prompt.includes(fan)) {
      expect(prompt.indexOf(fan)).toBeGreaterThan(prompt.indexOf(commit))
      expect(prompt.indexOf(limit)).toBeGreaterThan(prompt.indexOf(fan))
    } else {
      // session spawn-depth cap ≤ 1 omits Agent + the bullet (gold nw()>1)
      expect(prompt).toContain(limit)
      expect(prompt).not.toContain('you may use it to fan out')
    }
    const src = readFileSync(join(__dirname, '../workerAgent.ts'), 'utf-8')
    expect(src).toContain('you may use it to fan out')
    expect(src).toContain(
      '${fanOutBullet}- Limit changes to what your task requires',
    )
  })

  test('coordinator bms Artifact pages-are-HTML unique English', () => {
    const src = readFileSync(join(__dirname, '../coordinatorMode.ts'), 'utf-8')
    expect(src).toContain(
      '${ARTIFACT_TOOL_NAME} pages are HTML: when you delegate a report',
    )
    expect(src).toContain('do not name a')
    expect(src).toContain(
      'file as the deliverable, even when the source material is Markdown',
    )
    expect(src).toContain('${ARTIFACT_TOOL_NAME} types: a slide deck')
    expect(src).toContain('prefer plain data and markdown files')
    expect(src).toContain('isArtifactToolEligible')
    expect(src).toContain('isArtifactToolRegistered')
  })

  test('Agent tool name used in worker fan-out is Agent', () => {
    expect(AGENT_TOOL_NAME).toBe('Agent')
    expect(ARTIFACT_TOOL_NAME).toBe('Artifact')
  })
})
