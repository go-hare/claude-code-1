import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as policyLimitsModule from 'src/services/policyLimits/index.js'
import * as envUtils from 'src/utils/envUtils.js'
import {
  getOrgNewArtifactCreateNotice,
  isOrgNewArtifactApprovalRequired,
} from '../permissions.js'

const spies: Array<{ mockRestore: () => void }> = []
const tempDirs: string[] = []

afterEach(() => {
  policyLimitsModule._resetPolicyLimitsForTesting()
  while (spies.length > 0) {
    spies.pop()?.mockRestore()
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Wave 1A ArtifactTool org approval parity (P1-#27)', () => {
  test('invented tengu_org_requires_new_artifact_approval GrowthBook gate is removed', () => {
    const src = readFileSync(join(import.meta.dir, '../permissions.ts'), 'utf8')
    expect(src).not.toContain('tengu_org_requires_new_artifact_approval')
  })

  test('reads real official policy_limits artifact_create_notice.text (len()) when eligible', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'wave1a-artifact-policy-'))
    tempDirs.push(configDir)
    writeFileSync(
      join(configDir, 'policy-limits.json'),
      JSON.stringify({
        restrictions: {},
        artifact_create_notice: {
          text: 'Your organization requires a person to approve each new artifact.',
        },
      }),
    )

    spies.push(
      spyOn(envUtils, 'getClaudeConfigHomeDir').mockReturnValue(configDir),
      spyOn(policyLimitsModule, 'isPolicyLimitsEligible').mockReturnValue(true),
    )

    expect(getOrgNewArtifactCreateNotice()).toBe(
      'Your organization requires a person to approve each new artifact.',
    )
    expect(isOrgNewArtifactApprovalRequired()).toBe(true)

    // When user is not eligible for policy limits, returns null / false
    spies.pop()?.mockRestore()
    spies.push(
      spyOn(policyLimitsModule, 'isPolicyLimitsEligible').mockReturnValue(
        false,
      ),
    )
    expect(getOrgNewArtifactCreateNotice()).toBeNull()
    expect(
      isOrgNewArtifactApprovalRequired({
        orgRequiresNewArtifactApproval: false,
      }),
    ).toBe(false)
  })
})
