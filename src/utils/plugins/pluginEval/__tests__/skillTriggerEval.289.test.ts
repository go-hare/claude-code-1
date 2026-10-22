/**
 * densable 2.1.289 xf/yl/hl — evals/*.md query + should_trigger.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  formatSkillTriggerReport,
  loadSkillTriggerQueries,
  runSkillTriggerEval,
} from '../skillTriggerEval.js'
import {
  formatFrameLiveAdoptedCopy,
  formatFrameLiveLostCopy,
  formatSessionFrameLiveCopy,
} from '../../../bgCheckpoint.js'

describe('densable 2.1.289 skill trigger evals/*.md', () => {
  test('missing evals/ folder warns with gold copy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trig-miss-'))
    const r = await loadSkillTriggerQueries(join(dir, 'evals'))
    expect(r.queries).toEqual([])
    expect(r.warnings[0]).toContain('No evals/ folder found at')
    expect(r.warnings[0]).toContain('should_trigger')
  })

  test('valid md runs skipped until the model scorer is wired', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trig-ok-'))
    await mkdir(join(dir, 'evals'))
    await writeFile(
      join(dir, 'evals', 'q1.md'),
      `---
query: how do I export pdf
should_trigger: true
---
`,
    )
    const abort = new AbortController()
    const report = await runSkillTriggerEval(dir, abort.signal)
    expect(report.queries).toHaveLength(1)
    expect(report.skippedCount).toBe(1)
    expect(report.triggerResults[0]?.reason).toContain(
      'Model evaluation not yet wired up',
    )
    const text = formatSkillTriggerReport(report)
    expect(text).toContain('Level 1 — trigger tests:')
    expect(text).toContain('All trigger tests skipped')
    expect(text).toContain('Level 2 — interplay tests: not yet implemented')
  })
})

describe('densable 2.1.289 plugin eval --json trigger ring', () => {
  test('$R trigger fallback writes JSON when --json is set', async () => {
    const { readFileSync } = await import('fs')
    const src = readFileSync(
      join(import.meta.dir, '../../../../cli/handlers/pluginEval.ts'),
      'utf8',
    )
    const start = src.indexOf('JSON.stringify(trigger')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start - 400, start + 900)
    expect(body).toContain('if (options.json)')
    expect(body).toContain('process.stdout.write(jsonBody')
    expect(body).toContain('Wrote ${options.json}')
  })
})

describe('densable rM frameLiveLost copy', () => {
  test('one vs many monitors', () => {
    expect(formatFrameLiveLostCopy(0)).toBe('')
    expect(formatFrameLiveLostCopy(1)).toBe(
      "Couldn't move 1 Artifact comment monitor to the background session, so automatic replies stopped. Publish the Artifact again to turn them back on.",
    )
    expect(formatFrameLiveLostCopy(2)).toBe(
      "Couldn't move 2 Artifact comment monitors to the background session, so automatic replies stopped. Publish each Artifact again to turn them back on.",
    )
  })

  test('rM concatenates lost + tM success', () => {
    expect(formatSessionFrameLiveCopy({ ok: true })).toBe('')
    expect(
      formatSessionFrameLiveCopy({ ok: false, frameLiveLost: 1 }),
    ).toContain("Couldn't move 1 Artifact comment monitor")
    expect(
      formatSessionFrameLiveCopy({ ok: true, adopted_frame_live: 1 }),
    ).toBe(`\n${formatFrameLiveAdoptedCopy(1)}`)
    expect(
      formatSessionFrameLiveCopy({
        ok: true,
        frameLiveLost: 1,
        adopted_frame_live: 1,
      }),
    ).toBe(`\n${formatFrameLiveLostCopy(1)}\n${formatFrameLiveAdoptedCopy(1)}`)
  })
})
