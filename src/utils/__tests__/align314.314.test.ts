import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseSessionInfoFromLite } from '../listSessionsImpl.js'
import { extractFirstPromptFromHead } from '../sessionStoragePortable.js'
import { resolveSessionTitleInput } from '../sessionTitle.js'
import {
  getAllowedSettingSources,
  setAllowedSettingSources,
} from '../../bootstrap/state.js'
import { getSettingsForSourceUncached } from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { SettingsSchema } from '../settings/types.js'

describe('v2.1.314 alignments', () => {
  let tempDir: string
  let prevConfigDir: string | undefined
  let savedSources: ReturnType<typeof getAllowedSettingSources>

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'align314-'))
    prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempDir
    savedSources = getAllowedSettingSources()
    resetSettingsCache()
  })

  afterEach(() => {
    if (prevConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
    setAllowedSettingSources(savedSources)
    resetSettingsCache()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('#1371 SettingsSchema accepts forceRemoteSettingsRefresh', () => {
    const parsed = SettingsSchema().safeParse({
      forceRemoteSettingsRefresh: true,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.forceRemoteSettingsRefresh).toBe(true)
    }
  })

  test('#1378 extractFirstPromptFromHead skips isMeta and extracts command+args', () => {
    const claudeMdMeta = JSON.stringify({
      type: 'user',
      isMeta: true,
      message: { role: 'user', content: '# CLAUDE.md instructions' },
    })
    const slashCmd = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content:
          '<command-name>/review</command-name><command-args>PR 42</command-args>',
      },
    })
    expect(extractFirstPromptFromHead(`${claudeMdMeta}\n${slashCmd}\n`)).toBe(
      '/review PR 42',
    )

    const slashNoArgs = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: '<command-name>/clear</command-name>',
      },
    })
    expect(
      extractFirstPromptFromHead(`${claudeMdMeta}\n${slashNoArgs}\n`),
    ).toBe('/clear')
  })

  test('#1387 getSettingsForSourceUncached returns null for excluded --setting-sources', () => {
    writeFileSync(
      join(tempDir, 'settings.json'),
      JSON.stringify({ model: 'sonnet' }),
    )
    setAllowedSettingSources(['projectSettings'])
    resetSettingsCache()
    expect(getSettingsForSourceUncached('userSettings')).toBeNull()
  })

  test('#1412 parseSessionInfoFromLite returns null for deleted/bookkeeping-only remnant files', () => {
    const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const remnantTail = `{"type":"custom-title","sessionId":"${sid}","customTitle":"Old title"}\n`
    const res = parseSessionInfoFromLite(sid, {
      head: remnantTail,
      tail: remnantTail,
      mtime: Date.now(),
      size: remnantTail.length,
    })
    expect(res).toBeNull()
  })

  test('#1431 resolveSessionTitleInput extracts title input for prompt-based slash commands', () => {
    const commands = [
      {
        name: 'security-review',
        type: 'prompt',
        description: 'Review code for security issues',
      },
      {
        name: 'clear',
        type: 'local',
        description: 'Clear conversation',
      },
    ]
    expect(
      resolveSessionTitleInput({
        text: '<command-message>security-review</command-message><command-name>/security-review</command-name><command-args>auth.ts</command-args>',
        commands,
      }),
    ).toBe('/security-review auth.ts\nReview code for security issues')

    expect(
      resolveSessionTitleInput({
        text: '<command-name>/clear</command-name>',
        commands,
      }),
    ).toBeNull()
  })
})
