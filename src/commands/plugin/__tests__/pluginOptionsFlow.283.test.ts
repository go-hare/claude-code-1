import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../../..')

describe('PluginOptionsFlow densable ci async (2.1.283)', () => {
  test('walks sst/$Hn via credentials and q0/BVe/QDe/mtn', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/plugin/PluginOptionsFlow.tsx'),
      'utf8',
    )
    expect(src).toContain('useSessionServices')
    expect(src).toContain('getUnconfiguredOptions')
    expect(src).toContain('getUnconfiguredChannels')
    expect(src).toContain('loadPluginOptionsNw')
    expect(src).toContain('savePluginOptions')
    expect(src).toContain('loadMcpServerUserConfig')
    expect(src).toContain('saveMcpServerUserConfig')
    expect(src).toContain('storageV5')
    expect(src).toContain('credentials')
    expect(src).toContain('Failed to read saved plugin options')
    expect(src).toContain('Loading…')
    expect(src).toContain('saving.current')
    expect(src).toContain('finished.current')
    expect(src).toContain('saveOutcome')
  })

  test('getUnconfiguredChannels is async QDe', () => {
    const src = readFileSync(
      join(ROOT, 'src/utils/plugins/mcpPluginIntegration.ts'),
      'utf8',
    )
    expect(src).toContain('export async function getUnconfiguredChannels')
    expect(src).toContain('await loadMcpServerUserConfig')
  })
})
