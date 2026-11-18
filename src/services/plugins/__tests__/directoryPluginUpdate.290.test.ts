import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Directory plugin update error & marketplace download folder (#160, #98)', () => {
  test('pluginOperations handles directory_unavailable and folderNote', () => {
    const opsSrc = readFileSync(
      join(import.meta.dir, '../pluginOperations.ts'),
      'utf8',
    )
    expect(opsSrc).toContain("failureCode: 'directory_unavailable'")
    expect(opsSrc).toContain('Could not check "${pluginName}" for updates.')
    expect(opsSrc).toContain('is read from its folder,')
    expect(opsSrc).toContain(
      'Edits there take effect at the next session start or /reload-plugins.',
    )
  })

  test('pluginCliCommands prints folderNote before tick message', () => {
    const cliSrc = readFileSync(
      join(import.meta.dir, '../pluginCliCommands.ts'),
      'utf8',
    )
    expect(cliSrc).toContain('if (result.folderNote !== undefined)')
  })

  test('marketplaceManager rejects non-plain directory marketplace names', () => {
    const mmSrc = readFileSync(
      join(import.meta.dir, '../../../utils/plugins/marketplaceManager.ts'),
      'utf8',
    )
    expect(mmSrc).toContain(
      'is not a plain directory name; refusing to cache it',
    )
  })
})
