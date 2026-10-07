import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

/**
 * Fork product-cut: Anthropic Team/Enterprise control plane is gone.
 * User/project/local settings.json still merge. Org policy module deleted.
 */

const srcRoot = join(import.meta.dir, '../../src')

describe('enterprise product cut', () => {
  test('policyLimits module is gone', () => {
    expect(existsSync(join(srcRoot, 'services/policyLimits/index.ts'))).toBe(
      false,
    )
    expect(existsSync(join(srcRoot, 'services/policyLimits/types.ts'))).toBe(
      false,
    )
    expect(existsSync(join(srcRoot, 'services/policyLimits'))).toBe(false)
  })

  test('enterprise modules are deleted', () => {
    expect(
      existsSync(join(srcRoot, 'services/remoteManagedSettings/index.ts')),
    ).toBe(false)
    expect(existsSync(join(srcRoot, 'utils/settings/mdm/settings.ts'))).toBe(
      false,
    )
    expect(existsSync(join(srcRoot, 'services/tips/orgTips.ts'))).toBe(false)
    expect(
      existsSync(join(srcRoot, 'utils/model/enterpriseDefaultModel.ts')),
    ).toBe(false)
    expect(existsSync(join(srcRoot, 'utils/criPolicyWebhook.ts'))).toBe(false)
    expect(
      existsSync(join(srcRoot, 'utils/settings/remoteSettingsBackendView.ts')),
    ).toBe(false)
    expect(
      existsSync(
        join(
          srcRoot,
          'components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.tsx',
        ),
      ),
    ).toBe(false)
    expect(
      existsSync(join(srcRoot, 'dialog/specs/managedSettingsSecurity.ts')),
    ).toBe(false)
  })

  test('managed-settings.json source is empty', async () => {
    const { loadManagedFileSettings } = await import(
      '../../src/utils/settings/settings.ts'
    )
    expect(loadManagedFileSettings().settings).toBe(null)
    expect(loadManagedFileSettings().errors).toEqual([])
  })
})
