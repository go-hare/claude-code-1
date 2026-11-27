import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'

describe('2.1.299 REPL alignment', () => {
  const replDir = path.resolve(__dirname, '../repl')
  const replSrc = [
    fs.readFileSync(path.resolve(__dirname, '../REPL.tsx'), 'utf8'),
    ...fs
      .readdirSync(replDir)
      .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
      .sort()
      .map(f => fs.readFileSync(path.join(replDir, f), 'utf8')),
  ].join('\n')

  test('#575 plan-mode-bypass-notice fires one-time 800ms notice in plan mode when bypass permissions is available', () => {
    expect(replSrc).toContain('planModeBypassNoticeShownRef')
    expect(replSrc).toContain("toolPermissionContext.mode !== 'plan'")
    expect(replSrc).toContain(
      'toolPermissionContext.isBypassPermissionsModeAvailable !== true',
    )
    expect(replSrc).toContain('tengu_mode_plan_bypass_notice')
    expect(replSrc).toContain(
      "Session was started with bypass permissions, so plan mode won't ask before most edits or commands. Start a new session without bypass permissions for prompts in plan mode.",
    )
  })

  test('#597 /btw does not jump transcript to bottom when scrolled up in fullscreen', () => {
    const scrollPinSrc = fs.readFileSync(
      path.resolve(__dirname, '../../utils/scrollPin.ts'),
      'utf8',
    )
    expect(scrollPinSrc).toContain(
      "(promptSource === 'typed' || promptSource === 'suggestion_accepted')",
    )
    expect(scrollPinSrc).toContain(
      "ownSubmit ? 'ownSubmitLanded' : 'rowLanded'",
    )
    expect(replSrc).toContain('belowTranscriptSlotOpen')
    expect(replSrc).toContain(
      'scrollPin.onBelowTranscriptSlotChange(belowTranscriptSlotOpen)',
    )
    expect(scrollPinSrc).toContain('(this.viewport.handle?.isSticky() ?? true)')
    expect(scrollPinSrc).toContain('`progressOrPanel→${open}`')
  })
})
