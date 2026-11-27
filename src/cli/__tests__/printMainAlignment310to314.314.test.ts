import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function readModuleTree(entryPath: string, subDir: string): string {
  return [
    readFileSync(entryPath, 'utf8'),
    ...readdirSync(subDir)
      .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
      .sort()
      .map(f => readFileSync(join(subDir, f), 'utf8')),
  ].join('\n')
}

describe('main.tsx & cli/print.ts 2.1.311–2.1.314 alignment (#1281, #1359, #1385, #1413)', () => {
  const mainSrc = readFileSync(join(import.meta.dir, '../../main.tsx'), 'utf8')
  const printSrc = readModuleTree(
    join(import.meta.dir, '../print.ts'),
    join(import.meta.dir, '../print'),
  )

  test('#1281: main.tsx skips subcommand registration when mayDispatchSubcommand returns false', () => {
    expect(mainSrc).toContain('mayDispatchSubcommand(rawArgs)')
  })

  test('#1359: main.tsx awaits runHeadless and exits 1 with stderr output on startup error', () => {
    expect(mainSrc).toContain('await runHeadless(')
    expect(mainSrc).not.toContain('void runHeadless(')
    expect(mainSrc).toContain('await gracefulShutdown(1)')
  })

  test('#1385: print.ts refreshes SandboxManager config after restoreWorktreeForResume on --continue and --resume', () => {
    const matches = printSrc.match(
      /restoreWorktreeForResume\(result\.worktreeSession\)[\s\S]{0,200}SandboxManager\.refreshConfig\(\)/g,
    )
    expect(matches?.length).toBe(2)
  })

  test('#1413: print.ts acknowledges stream-json prompts with array text blocks and honors queueSkipSlashCommands', () => {
    expect(printSrc).toContain('queueSkipSlashCommands')
    expect(printSrc).toContain('claimFirstTurnAck?.({ queued: ackText })')
  })
})
