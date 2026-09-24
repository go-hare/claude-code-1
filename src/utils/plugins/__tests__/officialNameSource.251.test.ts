import { describe, expect, test } from 'bun:test'
import { sep } from 'path'
import {
  isOfficialAnthropicsGitUrl,
  validateOfficialNameSource,
} from '../schemas.js'
import {
  isOfficialMarketplaceInstallLocation,
  reservedMarketplaceLoadRefusal,
} from '../marketplaceManager.js'

describe('official marketplace name refuse (251 #27 $Y/fke)', () => {
  test('$Y skips a name that is not reserved', () => {
    expect(
      reservedMarketplaceLoadRefusal('acme-tools', {
        source: { source: 'github', repo: 'acme/tools' },
      }),
    ).toBeNull()
  })

  test('fke refuses a reserved github repo with ..', () => {
    expect(
      validateOfficialNameSource('claude-plugins-official', {
        source: 'github',
        repo: 'anthropics/../evil',
      }),
    ).toContain('github.com/anthropics/')
  })

  test('fke allows anthropics github and official git URL', () => {
    expect(
      validateOfficialNameSource('claude-plugins-official', {
        source: 'github',
        repo: 'anthropics/claude-plugins-official',
      }),
    ).toBeNull()
    expect(
      isOfficialAnthropicsGitUrl(
        'https://github.com/anthropics/claude-plugins-official.git',
      ),
    ).toBe(true)
    expect(
      validateOfficialNameSource('claude-plugins-official', {
        source: 'git',
        url: 'https://github.com/anthropics/claude-plugins-official.git',
      }),
    ).toBeNull()
    expect(
      validateOfficialNameSource('claude-plugins-official', {
        source: 'git',
        url: 'https://github.com/evil/clone.git',
      }),
    ).toContain('github.com/anthropics/')
  })

  test('$Y refuses a malformed source object', () => {
    expect(
      reservedMarketplaceLoadRefusal('claude-plugins-official', {
        source: null,
        installLocation: '/tmp/m',
      }),
    ).toBe(
      "The name 'claude-plugins-official' is reserved for official Anthropic marketplaces and its registered source is malformed.",
    )
  })

  test('zS is seed-dir prefix after resolve; $Y then returns null', () => {
    const prev = process.env.CLAUDE_CODE_PLUGIN_SEED_DIR
    process.env.CLAUDE_CODE_PLUGIN_SEED_DIR = '/seed-plugins'
    try {
      const location = '/seed-plugins/marketplaces/claude-plugins-official'
      // gold zS find returns the Zv() entry, not zp(entry)
      expect(isOfficialMarketplaceInstallLocation(location)).toBe(
        '/seed-plugins',
      )
      expect(
        reservedMarketplaceLoadRefusal('claude-plugins-official', {
          source: { source: 'github', repo: 'evil/clone' },
          installLocation: location,
        }),
      ).toBeNull()
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_PLUGIN_SEED_DIR
      } else {
        process.env.CLAUDE_CODE_PLUGIN_SEED_DIR = prev
      }
    }
  })

  test('zS does not treat a sibling path as a seed prefix', () => {
    const prev = process.env.CLAUDE_CODE_PLUGIN_SEED_DIR
    process.env.CLAUDE_CODE_PLUGIN_SEED_DIR = '/seed-plugins'
    try {
      const location = `/seed-plugins-evil${sep}marketplaces${sep}claude-plugins-official`
      expect(isOfficialMarketplaceInstallLocation(location)).toBeUndefined()
      expect(
        reservedMarketplaceLoadRefusal('claude-plugins-official', {
          source: { source: 'github', repo: 'evil/clone' },
          installLocation: location,
        }),
      ).toContain('github.com/anthropics/')
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CODE_PLUGIN_SEED_DIR
      } else {
        process.env.CLAUDE_CODE_PLUGIN_SEED_DIR = prev
      }
    }
  })
})
