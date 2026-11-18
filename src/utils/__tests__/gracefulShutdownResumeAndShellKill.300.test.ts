import { afterEach, describe, expect, test } from 'bun:test'
import {
  _resetLiveShellKillStateForTesting,
  awaitPendingShellKillBackstops,
  killLiveShellCommands,
  registerLiveShellCommand,
  SHELL_KILL_BACKSTOP_MS,
} from '../../tasks/LocalShellTask/killShellTasks.js'
import { formatResumeHint } from '../gracefulShutdown.js'

describe('2.1.299/2.1.300 #728/#729/#810 gracefulShutdown & live shell kill', () => {
  afterEach(() => {
    _resetLiveShellKillStateForTesting()
  })

  test('#728 formatResumeHint always uses sessionId and ignores custom titles', () => {
    const res = formatResumeHint({
      sessionId: '11111111-2222-3333-4444-555555555555',
    })
    expect(res.arg).toBe('id')
    expect(res.command).toBe(
      'claude --resume 11111111-2222-3333-4444-555555555555',
    )
    expect(res.advice).toEqual([])
  })

  test('#729 formatResumeHint degrades worktree flags from --worktree/--resume to -w/-r and then advice', () => {
    const sid = '11111111-2222-3333-4444-555555555555'
    const wt = { name: 'feature-x', recordCleared: true }

    // Wide terminal -> long flags
    const wide = formatResumeHint({
      sessionId: sid,
      worktree: wt,
      columns: 100,
    })
    expect(wide.worktree).toBe('printed')
    expect(wide.command).toBe(`claude --worktree "feature-x" --resume ${sid}`)
    expect(wide.advice).toEqual([])

    // Narrower terminal -> short flags -w / -r
    const shortCmd = `claude -w "feature-x" -r ${sid}`
    const medium = formatResumeHint({
      sessionId: sid,
      worktree: wt,
      columns: shortCmd.length,
    })
    expect(medium.worktree).toBe('printed_short_flags')
    expect(medium.command).toBe(shortCmd)
    expect(medium.advice).toEqual([])

    // Too narrow -> advice rows above + plain --resume
    const narrow = formatResumeHint({
      sessionId: sid,
      worktree: wt,
      columns: shortCmd.length - 1,
    })
    expect(narrow.worktree).toBe('too_wide')
    expect(narrow.command).toBe(`claude --resume ${sid}`)
    expect(narrow.advice).toEqual([
      'This session ran in a worktree',
      'In its folder, run the command below to resume in it',
      'To find that folder, try git worktree list',
    ])
  })

  test('#810 killLiveShellCommands kills running commands and awaits settled backstops', async () => {
    expect(SHELL_KILL_BACKSTOP_MS).toBe(1500)
    let killed = false
    let resolveResult!: () => void
    const result = new Promise<void>(r => {
      resolveResult = r
    })
    const unregister = registerLiveShellCommand({
      status: 'running',
      kill: () => {
        killed = true
        resolveResult()
      },
      result,
    })
    killLiveShellCommands()
    expect(killed).toBe(true)
    await awaitPendingShellKillBackstops()
    unregister()
  })
})
