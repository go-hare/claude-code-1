import { describe, expect, test } from 'bun:test'
import fs from 'fs'
import path from 'path'

describe('2.1.299 REPL alignment', () => {
  const replSrc = fs.readFileSync(
    path.resolve(__dirname, '../REPL.tsx'),
    'utf8',
  )

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
    expect(replSrc).toContain(
      "const ownSubmit = promptSource === 'typed' || promptSource === 'suggestion_accepted'",
    )
    expect(replSrc).toContain("repinScroll(false, 'ownSubmitLanded')")
    expect(replSrc).toContain("repinScroll(false, 'lastMsgIsHuman')")
    expect(replSrc).toContain('belowTranscriptSlotOpen')
    expect(replSrc).toContain('if (scrollRef.current?.isSticky() ?? true)')
    expect(replSrc).toContain('`progressOrPanel→${belowTranscriptSlotOpen}`')
  })
})
