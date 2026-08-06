/**
 * Official 2.1.x: SessionStart reloadSkills + sessionTitle; UPS suppressOriginalPrompt.
 * Pure classification mirrors (no process-global mock.module).
 */
import { describe, expect, test } from 'bun:test'

// densable 2.1.214 #47
type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact' | 'fork'

function shouldCacheSessionTitle(
  source: SessionStartSource,
  title: string | undefined,
): boolean {
  if (!title?.trim()) return false
  // densable: e==="startup"||e==="resume"||e==="fork"
  return source === 'startup' || source === 'resume' || source === 'fork'
}

/** densable REPL: xr==="fork"?"fork":"resume" */
function sessionStartSourceForResumeEntrypoint(
  entrypoint: 'fork' | 'cli_flag' | string,
): 'fork' | 'resume' {
  return entrypoint === 'fork' ? 'fork' : 'resume'
}

/** densable bridge trust: Rdr.homedir()===At() */
function formatRcWorkspaceTrustError(
  dir: string,
  isHomeDir: boolean,
  kind: 'interactive' | 'headless',
): string {
  if (kind === 'interactive') {
    return isHomeDir
      ? `Error: Workspace not trusted. ${dir} is your home directory, and for security home-directory trust is never saved, so running \`claude\` here first won't help. Run \`claude rc\` from a project directory instead (run \`claude\` there once to accept the trust dialog).`
      : `Error: Workspace not trusted. Please run \`claude\` in ${dir} first to review and accept the workspace trust dialog.`
  }
  return isHomeDir
    ? `Workspace not trusted: ${dir} is the home directory, whose trust is never saved \u2014 running \`claude\` there first won't help. Run Remote Control from a project directory instead.`
    : `Workspace not trusted: ${dir}. Run \`claude\` in that directory first to accept the trust dialog.`
}

function blockMessage(
  blockingMessage: string,
  originalPrompt: string,
  suppressOriginalPrompt: boolean,
): string {
  return suppressOriginalPrompt
    ? blockingMessage
    : `${blockingMessage}\n\nOriginal prompt: ${originalPrompt}`
}

function shouldReloadSkills(flags: boolean[]): boolean {
  return flags.some(Boolean)
}

describe('SessionStart sessionTitle cache gate', () => {
  test('startup and resume cache non-empty titles', () => {
    expect(shouldCacheSessionTitle('startup', 'My session')).toBe(true)
    expect(shouldCacheSessionTitle('resume', 'My session')).toBe(true)
  })

  test('fork also caches title (densable #47)', () => {
    expect(shouldCacheSessionTitle('fork', 'My session')).toBe(true)
  })

  test('clear/compact do not cache', () => {
    expect(shouldCacheSessionTitle('clear', 'My session')).toBe(false)
    expect(shouldCacheSessionTitle('compact', 'My session')).toBe(false)
  })

  test('empty title never caches', () => {
    expect(shouldCacheSessionTitle('startup', '')).toBe(false)
    expect(shouldCacheSessionTitle('startup', '   ')).toBe(false)
    expect(shouldCacheSessionTitle('startup', undefined)).toBe(false)
  })
})

describe('SessionStart source fork selection densable #47', () => {
  test('branch/fork entrypoint uses source fork', () => {
    expect(sessionStartSourceForResumeEntrypoint('fork')).toBe('fork')
  })
  test('other resume entrypoints use resume', () => {
    expect(sessionStartSourceForResumeEntrypoint('cli_flag')).toBe('resume')
    expect(sessionStartSourceForResumeEntrypoint('slash_command_picker')).toBe(
      'resume',
    )
  })
})

describe('RC home trust copy densable #43', () => {
  test('interactive home directory message', () => {
    const msg = formatRcWorkspaceTrustError('/home/u', true, 'interactive')
    expect(msg).toContain('is your home directory')
    expect(msg).toContain('home-directory trust is never saved')
    expect(msg).toContain('claude rc')
  })
  test('interactive non-home message', () => {
    const msg = formatRcWorkspaceTrustError('/proj', false, 'interactive')
    expect(msg).toContain('Please run `claude` in /proj first')
    expect(msg).not.toContain('home directory')
  })
  test('headless home directory message uses em dash', () => {
    const msg = formatRcWorkspaceTrustError('/home/u', true, 'headless')
    expect(msg).toContain('is the home directory')
    expect(msg).toContain('\u2014')
    expect(msg).toContain('Run Remote Control from a project directory')
  })
})

describe('SessionStart reloadSkills aggregation', () => {
  test('any true reloads', () => {
    expect(shouldReloadSkills([false, true, false])).toBe(true)
    expect(shouldReloadSkills([false, false])).toBe(false)
  })
})

describe('UserPromptSubmit suppressOriginalPrompt', () => {
  test('default includes original prompt', () => {
    expect(blockMessage('blocked', 'hello world', false)).toBe(
      'blocked\n\nOriginal prompt: hello world',
    )
  })

  test('suppress omits original prompt', () => {
    expect(blockMessage('blocked', 'hello world', true)).toBe('blocked')
  })
})
