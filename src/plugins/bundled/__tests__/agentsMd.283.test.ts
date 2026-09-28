import { describe, expect, test } from 'bun:test'
import {
  AGENTS_MD_PLUGIN_DESCRIPTION,
  AGENTS_MD_PLUGIN_NAME,
} from '../agentsMd.js'
import { USER_CONFIG } from '../../../../vendor/claude-code-mods/mods/agents-md/hooks/register.js'

describe('agents-md builtin plugin 2.1.283', () => {
  test('plugin name and /config title match gold', () => {
    expect(AGENTS_MD_PLUGIN_NAME).toBe('agents-md')
    expect(AGENTS_MD_PLUGIN_DESCRIPTION).toContain(
      'AGENTS.md as project instructions',
    )
    expect(USER_CONFIG.instructionFiles.title).toBe('Project instructions')
  })
})
