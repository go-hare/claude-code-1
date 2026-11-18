import { afterEach, describe, expect, test } from 'bun:test'
import { getShellDescription, getShellInfoLine } from '../prompts.js'

describe('#1237 getShellDescription / getShellInfoLine', () => {
  const origShell = process.env.SHELL
  const origOverride = process.env.CLAUDE_CODE_SHELL

  afterEach(() => {
    if (origShell === undefined) delete process.env.SHELL
    else process.env.SHELL = origShell
    if (origOverride === undefined) delete process.env.CLAUDE_CODE_SHELL
    else process.env.CLAUDE_CODE_SHELL = origOverride
  })

  test('reports actual POSIX shell with login shell annotation when SHELL differs (e.g. fish)', () => {
    if (process.platform === 'win32') return
    process.env.SHELL = '/opt/homebrew/bin/fish'
    delete process.env.CLAUDE_CODE_SHELL

    const desc = getShellDescription()
    expect(desc).toMatch(/^(zsh|bash) \(login shell: fish\)$/)
    expect(getShellInfoLine()).toBe(`Shell: ${desc}`)
  })

  test('reports bare shell name without login shell suffix when SHELL matches resolved shell', () => {
    if (process.platform === 'win32') return
    process.env.SHELL = '/bin/zsh'
    delete process.env.CLAUDE_CODE_SHELL

    const desc = getShellDescription()
    expect(desc).toBe('zsh')
    expect(getShellInfoLine()).toBe('Shell: zsh')
  })

  test('honors CLAUDE_CODE_SHELL override when valid bash/zsh', () => {
    if (process.platform === 'win32') return
    process.env.SHELL = '/opt/homebrew/bin/fish'
    process.env.CLAUDE_CODE_SHELL = '/bin/bash'

    const desc = getShellDescription()
    expect(desc).toBe('bash (login shell: fish)')
  })
})
